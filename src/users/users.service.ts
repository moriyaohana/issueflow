import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { actorOf } from '../audit-log/audit-log.helpers';
import { AuditAction } from '../common/enums/audit-action.enum';
import { EntityType } from '../common/enums/entity-type.enum';
import { UserRole } from '../common/enums/user-role.enum';

/**
 * Minimal shape of the authenticated caller required to authorise role-bearing
 * writes. Accepting an `Actor` (rather than just an id) keeps the policy in
 * the service while letting controllers forward whatever JWT payload they
 * already have.
 */
export interface Actor {
  id: number;
  role: UserRole;
}

// Postgres unique-violation error code; surfaced as 409 instead of 500.
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService,
    private readonly audit: AuditLogService,
  ) {}

  async create(
    dto: CreateUserDto,
    actor: Actor | null = null,
  ): Promise<UserResponseDto> {
    // Role-assignment policy lives in the service so non-HTTP callers can't
    // bypass it. Internal callers (seed scripts, the e2e test factory) pass
    // `actor = null` and are trusted; only HTTP requests forward a real actor.
    if (actor && dto.role === UserRole.ADMIN && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can assign the ADMIN role');
    }
    const actorUserId = actor?.id ?? null;
    const rounds = parseInt(this.config.get<string>('BCRYPT_ROUNDS', '10'), 10);
    const passwordHash = await bcrypt.hash(dto.password, rounds);
    const user = this.users.create({
      username: dto.username,
      email: dto.email,
      fullName: dto.fullName,
      role: dto.role,
      passwordHash,
    });
    try {
      const saved = await this.users.save(user);
      await this.audit.record({
        action: AuditAction.CREATE,
        entityType: EntityType.USER,
        entityId: saved.id,
        ...actorOf(actorUserId),
      });
      return UserResponseDto.fromEntity(saved);
    } catch (err: any) {
      if (err?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('Username or email already exists');
      }
      throw err;
    }
  }

  async findAll(): Promise<UserResponseDto[]> {
    const rows = await this.users.find({ where: { deletedAt: IsNull() } });
    return rows.map(UserResponseDto.fromEntity);
  }

  async findOne(id: number): Promise<UserResponseDto> {
    const user = await this.users.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return UserResponseDto.fromEntity(user);
  }

  /**
   * Internal lookup that returns the raw entity including soft-deleted rows.
   * Used by restore and by audit/cascade flows that legitimately need to see
   * a user that's been removed from public listings.
   */
  async findOneIncludingDeleted(id: number): Promise<User> {
    const user = await this.findOptionalIncludingDeleted(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  /**
   * Null-returning variant of {@link findOneIncludingDeleted} for callers
   * that need to branch on existence without paying for an exception. Used
   * by `ProjectsService.create` to distinguish "owner missing" (404) from
   * "owner soft-deleted" (400) without abusing try/catch for control flow.
   */
  async findOptionalIncludingDeleted(id: number): Promise<User | null> {
    return this.users.findOne({
      where: { id },
      withDeleted: true,
    });
  }

  async update(
    id: number,
    dto: UpdateUserDto,
    actor: Actor | null = null,
  ): Promise<UserResponseDto> {
    // Role writes are admin-only, and an admin cannot change their own role
    // (prevents an ADMIN demoting themselves and locking the system out).
    // Non-role fields (e.g. `fullName`) are unaffected — an ADMIN can still
    // rename themselves.
    if (actor && dto.role !== undefined) {
      if (actor.role !== UserRole.ADMIN) {
        throw new ForbiddenException('Only admins can change a user role');
      }
      if (id === actor.id) {
        throw new ForbiddenException('Admins cannot change their own role');
      }
    }
    const actorUserId = actor?.id ?? null;
    const user = await this.users.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    if (dto.fullName !== undefined) user.fullName = dto.fullName;
    if (dto.role !== undefined) user.role = dto.role;
    const saved = await this.users.save(user);
    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: EntityType.USER,
      entityId: saved.id,
      ...actorOf(actorUserId),
    });
    return UserResponseDto.fromEntity(saved);
  }

  async softDelete(
    id: number,
    actorUserId: number | null = null,
  ): Promise<void> {
    const user = await this.users.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    await this.users.softRemove(user);
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: EntityType.USER,
      entityId: user.id,
      ...actorOf(actorUserId),
    });
  }

  /**
   * Returns the raw User including `passwordHash`. Soft-deleted users are
   * excluded so a deleted account cannot authenticate.
   * Used only by AuthService.login during password verification.
   */
  async findByUsernameWithPassword(username: string): Promise<User | null> {
    return this.users.findOne({
      where: { username, deletedAt: IsNull() },
      select: [
        'id',
        'username',
        'email',
        'fullName',
        'role',
        'passwordHash',
        'deletedAt',
      ],
    });
  }

  async existsAndActive(id: number): Promise<boolean> {
    const count = await this.users.count({
      where: { id, deletedAt: IsNull() },
    });
    return count > 0;
  }

  /**
   * Lean lookup used on the auth hot-path (JwtStrategy.validate runs on every
   * authenticated request). Returns the minimal `{id, role}` projection of an
   * active user, or null if the row is missing/soft-deleted. Collapses the
   * previous existsAndActive + (implicit) role-from-payload pair into a single
   * query against the live row.
   */
  async findActiveById(
    id: number,
  ): Promise<Pick<User, 'id' | 'role'> | null> {
    return this.users.findOne({
      where: { id, deletedAt: IsNull() },
      select: ['id', 'role'],
    });
  }

  /**
   * Case-insensitive lookup for @mention parsing. Soft-deleted users are
   * excluded so we never persist mentions pointing at hidden accounts.
   *
   * Projection is narrowed to the wire-safe `MentionParser` shape so even
   * a future caller that forgets to map through `ResolvedMention` cannot
   * leak `email` / `passwordHash` over the wire.
   */
  async findByUsernamesCaseInsensitive(
    usernames: string[],
  ): Promise<Pick<User, 'id' | 'username' | 'fullName'>[]> {
    if (usernames.length === 0) return [];
    const lower = usernames.map((u) => u.toLowerCase());
    return this.users
      .createQueryBuilder('u')
      .select(['u.id', 'u.username', 'u.fullName'])
      .where('LOWER(u.username) IN (:...lower)', { lower })
      .andWhere('u.deletedAt IS NULL')
      .getMany();
  }
}
