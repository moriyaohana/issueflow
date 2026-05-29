import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const config = {
    get: jest.fn().mockReturnValue('secret'),
  } as unknown as ConfigService;

  function makeStrategy(opts: {
    invalidatedHas: boolean;
    userActive: boolean;
  }): JwtStrategy {
    const users: any = {
      findActiveById: jest
        .fn()
        .mockResolvedValue(opts.userActive ? { id: 1, role: 'DEVELOPER' } : null),
    };
    const invalidated: any = {
      has: jest.fn().mockResolvedValue(opts.invalidatedHas),
    };
    return new JwtStrategy(config, users, invalidated);
  }

  const payload = {
    sub: 1,
    username: 'u',
    role: 'DEVELOPER',
    jti: 'jti-1',
    exp: 1900000000,
  };

  it('rejects when jti is in the deny-list', async () => {
    const strategy = makeStrategy({ invalidatedHas: true, userActive: true });
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when user is no longer active (soft-deleted)', async () => {
    const strategy = makeStrategy({ invalidatedHas: false, userActive: false });
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when jti is missing from the payload', async () => {
    const strategy = makeStrategy({ invalidatedHas: false, userActive: true });
    await expect(
      strategy.validate({ ...payload, jti: undefined as unknown as string }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns the user-shaped payload on success', async () => {
    const strategy = makeStrategy({ invalidatedHas: false, userActive: true });
    const result = await strategy.validate(payload);
    expect(result).toEqual({
      id: 1,
      username: 'u',
      role: 'DEVELOPER',
      jti: 'jti-1',
      exp: 1900000000,
    });
  });

  it('rejects when exp is missing from the payload', async () => {
    const strategy = makeStrategy({ invalidatedHas: false, userActive: true });
    const { exp: _exp, ...noExp } = payload;
    await expect(
      strategy.validate(noExp as unknown as typeof payload),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
