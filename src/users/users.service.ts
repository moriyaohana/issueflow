import {
  ConflictException,
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

// Postgres unique-violation error code; surfaced as 409 instead of 500.
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
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
    const user = await this.users.findOne({ where: { id, deletedAt: IsNull() } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return UserResponseDto.fromEntity(user);
  }

  /**
   * Internal lookup that returns the raw entity including soft-deleted rows.
   * Used by restore and by audit/cascade flows that legitimately need to see
   * a user that's been removed from public listings.
   */
  async findOneIncludingDeleted(id: number): Promise<User> {
    const user = await this.users.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async update(id: number, dto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.users.findOne({ where: { id, deletedAt: IsNull() } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    if (dto.fullName !== undefined) user.fullName = dto.fullName;
    if (dto.role !== undefined) user.role = dto.role;
    const saved = await this.users.save(user);
    return UserResponseDto.fromEntity(saved);
  }

  async softDelete(id: number): Promise<void> {
    const user = await this.users.findOne({ where: { id, deletedAt: IsNull() } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    await this.users.softRemove(user);
  }

  async restore(id: number): Promise<UserResponseDto> {
    const user = await this.findOneIncludingDeleted(id);
    if (!user.deletedAt) {
      return UserResponseDto.fromEntity(user);
    }
    await this.users.restore(id);
    const reloaded = await this.users.findOne({ where: { id } });
    return UserResponseDto.fromEntity(reloaded);
  }

  /**
   * Returns the raw User including `passwordHash`. Soft-deleted users are
   * excluded so a deleted account cannot authenticate.
   * Used only by AuthService.login during password verification.
   */
  async findByUsernameWithPassword(username: string): Promise<User | null> {
    return this.users.findOne({
      where: { username, deletedAt: IsNull() },
      select: ['id', 'username', 'email', 'fullName', 'role', 'passwordHash', 'deletedAt'],
    });
  }

  async existsAndActive(id: number): Promise<boolean> {
    const count = await this.users.count({ where: { id, deletedAt: IsNull() } });
    return count > 0;
  }

  /**
   * Case-insensitive lookup for @mention parsing. Soft-deleted users are
   * excluded so we never persist mentions pointing at hidden accounts.
   */
  async findByUsernamesCaseInsensitive(usernames: string[]): Promise<User[]> {
    if (usernames.length === 0) return [];
    const lower = usernames.map((u) => u.toLowerCase());
    return this.users
      .createQueryBuilder('u')
      .where('LOWER(u.username) IN (:...lower)', { lower })
      .andWhere('u.deletedAt IS NULL')
      .getMany();
  }
}
