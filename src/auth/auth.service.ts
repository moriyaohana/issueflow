import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { InvalidatedTokensService } from './invalidated-tokens.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../common/enums/audit-action.enum';
import { EntityType } from '../common/enums/entity-type.enum';
import { ActorType } from '../common/enums/actor-type.enum';

export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly invalidated: InvalidatedTokensService,
    private readonly audit: AuditLogService,
  ) {}

  async login(dto: LoginDto): Promise<{ result: LoginResult; userId: number }> {
    const user = await this.users.findByUsernameWithPassword(dto.username);
    if (!user) {
      // Brute-force / credential-stuffing signal: record the attempt even when
      // the username doesn't resolve. We never persist the password itself.
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        entityType: EntityType.USER,
        entityId: 0,
        performedBy: null,
        actor: ActorType.SYSTEM,
        metadata: { attemptedUsername: dto.username, reason: 'unknown_user' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        entityType: EntityType.USER,
        entityId: user.id,
        performedBy: null,
        actor: ActorType.SYSTEM,
        metadata: { attemptedUsername: dto.username, reason: 'bad_password' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    const jti = uuidv4();
    // `process.env` values are strings; ConfigService preserves that, so we
    // must coerce explicitly to avoid `expiresIn` round-tripping to clients as
    // a string. The signing library also expects a number-or-duration-string,
    // and a string of digits is treated as ms — using a number is the safe path.
    const expiresInSeconds = parseInt(
      this.config.get<string>('JWT_EXPIRES_IN', '3600'),
      10,
    );
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, role: user.role, jti },
      { expiresIn: expiresInSeconds },
    );
    await this.audit.record({
      action: AuditAction.LOGIN,
      entityType: EntityType.USER,
      entityId: user.id,
      performedBy: user.id,
      actor: ActorType.USER,
    });
    return {
      result: {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: expiresInSeconds,
      },
      userId: user.id,
    };
  }

  async logout(
    jti: string,
    userId: number,
    expirySeconds: number,
  ): Promise<void> {
    const expiresAt = new Date(expirySeconds * 1000);
    await this.invalidated.add(jti, expiresAt);
    // Logout = invalidating the session token; modelled as DELETE on the user
    // session (entityType=USER, entityId=user id). The README vocabulary
    // doesn't include a dedicated LOGOUT verb.
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: EntityType.USER,
      entityId: userId,
      performedBy: userId,
      actor: ActorType.USER,
      metadata: { event: 'logout' },
    });
  }
}
