import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import { InvalidatedTokensService } from '../invalidated-tokens.service';
import { UserRole } from '../../common/enums/user-role.enum';

export interface JwtPayload {
  sub: number;
  username: string;
  role: string;
  jti: string;
  exp?: number;
  iat?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
    private readonly invalidated: InvalidatedTokensService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'dev-secret-change-me'),
    });
  }

  /**
   * Validates a decoded JWT payload. Three rejection paths exist:
   *   1. The `jti` is in the deny-list (token was explicitly logged out).
   *   2. The user no longer exists (account was hard-deleted - shouldn't
   *      happen in this system but defended for safety).
   *   3. The user was soft-deleted after the token was issued.
   */
  async validate(payload: JwtPayload): Promise<{
    id: number;
    username: string;
    role: UserRole;
    jti: string;
    exp: number;
  }> {
    if (!payload?.jti) {
      throw new UnauthorizedException('Token missing jti');
    }
    if (typeof payload.exp !== 'number') {
      throw new UnauthorizedException('Token missing exp');
    }
    if (await this.invalidated.has(payload.jti)) {
      throw new UnauthorizedException('Token has been revoked');
    }
    // Reject tokens whose `role` claim isn't part of the current UserRole
    // vocabulary. This guards against legacy tokens signed before a role was
    // retired and prevents a forged/typo'd role string from sneaking past
    // RolesGuard (which does an `includes` check on string equality).
    if (!Object.values(UserRole).includes(payload.role as UserRole)) {
      throw new UnauthorizedException('Token has an unknown role');
    }
    const active = await this.users.existsAndActive(payload.sub);
    if (!active) {
      throw new UnauthorizedException('User no longer active');
    }
    return {
      id: payload.sub,
      username: payload.username,
      role: payload.role as UserRole,
      jti: payload.jti,
      exp: payload.exp,
    };
  }
}
