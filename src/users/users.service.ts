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
import { entityNotFound } from '../common/errors/messages';

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
    // null actor = trusted internal caller (seed scripts, e2e factory).
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

  async findOneIncludingDeleted(id: number): Promise<User> {
    const user = await this.findOptionalIncludingDeleted(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

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
    // Self-role-change is rejected so an admin can't demote themselves and
    // lock everyone out; non-role updates are always allowed.
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

  // Only path that opts into `passwordHash` (entity has `select: false`).
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

  async assertActive(id: number): Promise<void> {
    if (!(await this.existsAndActive(id))) {
      throw new NotFoundException(entityNotFound(EntityType.USER, id));
    }
  }

  async findActiveById(
    id: number,
  ): Promise<Pick<User, 'id' | 'role'> | null> {
    return this.users.findOne({
      where: { id, deletedAt: IsNull() },
      select: ['id', 'role'],
    });
  }

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
