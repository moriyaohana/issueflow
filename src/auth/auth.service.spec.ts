import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { InvalidatedTokensService } from './invalidated-tokens.service';
import { UserRole } from '../common/enums/user-role.enum';

describe('AuthService', () => {
  let service: AuthService;
  let users: { findByUsernameWithPassword: jest.Mock };
  let invalidated: { add: jest.Mock; has: jest.Mock };
  let jwt: { signAsync: jest.Mock };

  beforeEach(async () => {
    users = { findByUsernameWithPassword: jest.fn() };
    invalidated = { add: jest.fn().mockResolvedValue(undefined), has: jest.fn() };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt') };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: InvalidatedTokensService, useValue: invalidated },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('3600s') } },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('rejects login when user not found', async () => {
    users.findByUsernameWithPassword.mockResolvedValueOnce(null);
    await expect(service.login({ username: 'ghost', password: 'pw' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects login when password does not match', async () => {
    const hash = await bcrypt.hash('correct', 4);
    users.findByUsernameWithPassword.mockResolvedValueOnce({
      id: 1,
      username: 'u',
      role: UserRole.DEVELOPER,
      passwordHash: hash,
    });
    await expect(service.login({ username: 'u', password: 'wrong' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('signs and returns a JWT on successful login', async () => {
    const hash = await bcrypt.hash('right', 4);
    users.findByUsernameWithPassword.mockResolvedValueOnce({
      id: 42,
      username: 'u',
      role: UserRole.ADMIN,
      passwordHash: hash,
    });
    const { result, userId } = await service.login({ username: 'u', password: 'right' });
    expect(userId).toBe(42);
    expect(result.accessToken).toBe('signed.jwt');
    expect(result.tokenType).toBe('Bearer');
    expect(result.expiresIn).toBe(3600);
    expect(jwt.signAsync).toHaveBeenCalled();
  });

  it('logout adds the jti to the deny-list', async () => {
    await service.logout('some-jti');
    expect(invalidated.add).toHaveBeenCalledWith('some-jti', expect.any(Date));
  });
});
