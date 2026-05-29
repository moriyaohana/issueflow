import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService, LoginResult } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import { UserResponseDto } from '../users/dto/user-response.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  // Per-IP rate limit: 5 attempts / 60s. Tight enough to neuter credential
  // stuffing, loose enough to absorb a human fat-fingering their password a
  // few times. Applied route-locally (rather than globally) so the rest of
  // the API — and the test suite's setup traffic — isn't affected.
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<LoginResult> {
    const { result } = await this.auth.login(dto);
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: CurrentUserPayload): Promise<void> {
    if (!user?.jti) {
      throw new UnauthorizedException();
    }
    await this.auth.logout(user.jti, user.id, user.exp);
  }

  @Get('me')
  async me(@CurrentUser() user: CurrentUserPayload): Promise<UserResponseDto> {
    return this.users.findOne(user.id);
  }
}
