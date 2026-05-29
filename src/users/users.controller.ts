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
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';

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

  @Post()
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<UserResponseDto> {
    return this.users.create(dto, actor);
  }

  @Post('update/:userId')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  update(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<UserResponseDto> {
    return this.users.update(userId, dto, actor);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  async delete(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<void> {
    await this.users.softDelete(userId, actor.id);
  }
}
