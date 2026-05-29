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
import { ProjectResponseDto } from './dto/project-response.dto';
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
  async listDeleted(): Promise<ProjectResponseDto[]> {
    const rows = await this.projects.findAllDeleted();
    return rows.map(ProjectResponseDto.fromEntity);
  }

  @Get()
  async list(): Promise<ProjectResponseDto[]> {
    const rows = await this.projects.findAll();
    return rows.map(ProjectResponseDto.fromEntity);
  }

  @Get(':projectId')
  async get(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<ProjectResponseDto> {
    const project = await this.projects.findOne(projectId);
    return ProjectResponseDto.fromEntity(project);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<ProjectResponseDto> {
    const project = await this.projects.create(dto, actor.id);
    return ProjectResponseDto.fromEntity(project);
  }

  @Patch(':projectId')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<void> {
    await this.projects.update(projectId, dto, actor.id);
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
  async restore(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<void> {
    await this.projects.restore(projectId, actor.id);
  }
}
