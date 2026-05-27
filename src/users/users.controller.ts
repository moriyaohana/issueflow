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
