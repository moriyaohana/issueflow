import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { InvalidatedTokensService } from './invalidated-tokens.service';

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
  ) {}

  async login(dto: LoginDto): Promise<{ result: LoginResult; userId: number }> {
    const user = await this.users.findByUsernameWithPassword(dto.username);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const jti = uuidv4();
    const expiresInSetting = this.config.get<string>('JWT_EXPIRES_IN', '3600s');
    const expiresInSeconds = this.toSeconds(expiresInSetting);
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, role: user.role, jti },
      { expiresIn: expiresInSeconds },
    );
    return {
      result: {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: expiresInSeconds,
      },
      userId: user.id,
    };
  }

  async logout(jti: string, expirySeconds?: number): Promise<void> {
    const expiresAt = expirySeconds
      ? new Date(expirySeconds * 1000)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.invalidated.add(jti, expiresAt);
  }

  private toSeconds(value: string): number {
    const match = /^(\d+)\s*(s|m|h|d)?$/.exec(value.trim());
    if (!match) return parseInt(value, 10) || 3600;
    const n = parseInt(match[1], 10);
    const unit = match[2] || 's';
    switch (unit) {
      case 'm':
        return n * 60;
      case 'h':
        return n * 3600;
      case 'd':
        return n * 86400;
      default:
        return n;
    }
  }
}
