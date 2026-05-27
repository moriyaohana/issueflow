import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';

type Repo<T> = Partial<Record<keyof any, jest.Mock>>;

describe('UsersService', () => {
  let service: UsersService;
  let repo: Repo<User>;

  beforeEach(async () => {
    repo = {
      create: jest.fn().mockImplementation((data) => ({ id: 1, ...data })),
      save: jest.fn().mockImplementation((u) => Promise.resolve({ id: 1, ...u })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      softRemove: jest.fn().mockResolvedValue(undefined),
      restore: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(1),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('4') } },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  it('hashes the password and never returns it in the response', async () => {
    const result = await service.create({
      username: 'jdoe',
      email: 'jdoe@example.com',
      fullName: 'John Doe',
      role: UserRole.DEVELOPER,
      password: 'secret-pw-12345',
    });

    const created = (repo.create as jest.Mock).mock.calls[0][0];
    expect(created.passwordHash).toBeDefined();
    expect(created.passwordHash).not.toBe('secret-pw-12345');
    const matches = await bcrypt.compare('secret-pw-12345', created.passwordHash);
    expect(matches).toBe(true);

    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).toMatchObject({
      id: 1,
      username: 'jdoe',
      email: 'jdoe@example.com',
      fullName: 'John Doe',
      role: UserRole.DEVELOPER,
    });
  });

  it('maps Postgres unique-violation to ConflictException', async () => {
    (repo.save as jest.Mock).mockRejectedValueOnce({ code: '23505' });
    await expect(
      service.create({
        username: 'dup',
        email: 'dup@example.com',
        fullName: 'Dup',
        role: UserRole.DEVELOPER,
        password: 'secret-pw-12345',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException when fetching a missing user', async () => {
    (repo.findOne as jest.Mock).mockResolvedValueOnce(null);
    await expect(service.findOne(999)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('soft-deletes via TypeORM softRemove', async () => {
    const user = { id: 5, deletedAt: null };
    (repo.findOne as jest.Mock).mockResolvedValueOnce(user);
    await service.softDelete(5);
    expect(repo.softRemove).toHaveBeenCalledWith(user);
  });

  it('findByUsernameWithPassword excludes soft-deleted users', async () => {
    (repo.findOne as jest.Mock).mockResolvedValueOnce(null);
    const result = await service.findByUsernameWithPassword('ghost');
    expect(result).toBeNull();
    const where = (repo.findOne as jest.Mock).mock.calls[0][0].where;
    expect(where.deletedAt).toBeDefined();
  });
});
