import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<UserResponseDto[]> {
    return this.users.findAll();
  }

  @Get(':userId')
  get(@Param('userId', ParseIntPipe) userId: number): Promise<UserResponseDto> {
    return this.users.findOne(userId);
  }

  // Bootstrap path: Agent 3 marks routes that don't require auth via @Public.
  // Until auth lands the global guard is absent, so the @Public marker is a
  // no-op now and starts taking effect once JwtAuthGuard is registered.
  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.users.create(dto);
  }

  @Post('update/:userId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.users.update(userId, dto);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('userId', ParseIntPipe) userId: number): Promise<void> {
    await this.users.softDelete(userId);
  }
}
