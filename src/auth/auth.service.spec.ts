import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { InvalidatedTokensService } from './invalidated-tokens.service';
import { UserRole } from '../common/enums/user-role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ActorType } from '../common/enums/actor-type.enum';

const USER_ID = 42;
const EXP_SECONDS = 1900000000; // far-future epoch second
const DEFAULT_JWT_EXPIRES_IN = 3600;

describe('AuthService', () => {
  let service: AuthService;
  let users: { findByUsernameWithPassword: jest.Mock };
  let invalidated: { add: jest.Mock; has: jest.Mock };
  let jwt: { signAsync: jest.Mock };
  let audit: { record: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    users = { findByUsernameWithPassword: jest.fn() };
    invalidated = {
      add: jest.fn().mockResolvedValue(undefined),
      has: jest.fn(),
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt') };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    config = {
      get: jest.fn((_key: string, fallback?: unknown) =>
        fallback === undefined ? DEFAULT_JWT_EXPIRES_IN : fallback,
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: InvalidatedTokensService, useValue: invalidated },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('rejects login when user not found', async () => {
    users.findByUsernameWithPassword.mockResolvedValueOnce(null);
    await expect(
      service.login({ username: 'ghost', password: 'pw' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects login when password does not match', async () => {
    const hash = await bcrypt.hash('correct', 4);
    users.findByUsernameWithPassword.mockResolvedValueOnce({
      id: 1,
      username: 'u',
      role: UserRole.DEVELOPER,
      passwordHash: hash,
    });
    await expect(
      service.login({ username: 'u', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('signs and returns a JWT on successful login', async () => {
    const hash = await bcrypt.hash('right', 4);
    users.findByUsernameWithPassword.mockResolvedValueOnce({
      id: USER_ID,
      username: 'u',
      role: UserRole.ADMIN,
      passwordHash: hash,
    });
    const { result, userId } = await service.login({
      username: 'u',
      password: 'right',
    });
    expect(userId).toBe(USER_ID);
    expect(result.accessToken).toBe('signed.jwt');
    expect(result.tokenType).toBe('Bearer');
    expect(result.expiresIn).toBe(DEFAULT_JWT_EXPIRES_IN);
    expect(jwt.signAsync).toHaveBeenCalled();
  });

  it('login uses integer JWT_EXPIRES_IN from config', async () => {
    config.get.mockImplementation((key: string, fallback?: unknown) =>
      key === 'JWT_EXPIRES_IN' ? 120 : fallback,
    );
    const hash = await bcrypt.hash('right', 4);
    users.findByUsernameWithPassword.mockResolvedValueOnce({
      id: USER_ID,
      username: 'u',
      role: UserRole.ADMIN,
      passwordHash: hash,
    });
    const { result } = await service.login({
      username: 'u',
      password: 'right',
    });
    expect(result.expiresIn).toBe(120);
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ expiresIn: 120 }),
    );
  });

  it('logout adds the jti to the deny-list with the token expiry and audits the userId', async () => {
    await service.logout('some-jti', USER_ID, EXP_SECONDS);
    expect(invalidated.add).toHaveBeenCalledWith(
      'some-jti',
      new Date(EXP_SECONDS * 1000),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ performedBy: USER_ID, actor: ActorType.USER }),
    );
  });
});
