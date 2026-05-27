import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService, LoginResult } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import { UserResponseDto } from '../users/dto/user-response.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<LoginResult> {
    const { result } = await this.auth.login(dto);
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: CurrentUserPayload): Promise<{ ok: true }> {
    if (!user?.jti) {
      throw new UnauthorizedException();
    }
    await this.auth.logout(user.jti);
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() user: CurrentUserPayload): Promise<UserResponseDto> {
    return this.users.findOne(user.id);
  }
}
