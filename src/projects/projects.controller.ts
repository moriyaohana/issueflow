import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Project } from './entities/project.entity';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('deleted')
  @Roles(UserRole.ADMIN)
  listDeleted(): Promise<Project[]> {
    return this.projects.findAllDeleted();
  }

  @Get()
  list(): Promise<Project[]> {
    return this.projects.findAll();
  }

  @Get(':projectId')
  get(@Param('projectId', ParseIntPipe) projectId: number): Promise<Project> {
    return this.projects.findOne(projectId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<Project> {
    return this.projects.create(dto, actor.id);
  }

  @Patch(':projectId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<Project> {
    return this.projects.update(projectId, dto, actor.id);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<void> {
    await this.projects.softDelete(projectId, actor.id);
  }

  @Post(':projectId/restore')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  restore(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<Project> {
    return this.projects.restore(projectId, actor.id);
  }
}
