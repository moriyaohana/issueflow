import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<UserResponseDto> {
    this.assertCanAssignRole(dto.role, actor);
    return this.users.create(dto, actor.id);
  }

  @Post('update/:userId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<UserResponseDto> {
    this.assertCanAssignRole(dto.role, actor);
    return this.users.update(userId, dto, actor.id);
  }

  private assertCanAssignRole(
    role: UserRole | undefined,
    actor: CurrentUserPayload,
  ): void {
    if (role === UserRole.ADMIN && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can assign the ADMIN role');
    }
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<void> {
    await this.users.softDelete(userId, actor.id);
  }
}
