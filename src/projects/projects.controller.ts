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
  UseGuards,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Project } from './entities/project.entity';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  // Static route segments must precede `:projectId` so they aren't shadowed.
  @Get('deleted')
  @UseGuards(RolesGuard)
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
  create(@Body() dto: CreateProjectDto): Promise<Project> {
    return this.projects.create(dto);
  }

  @Patch(':projectId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: UpdateProjectDto,
  ): Promise<Project> {
    return this.projects.update(projectId, dto);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('projectId', ParseIntPipe) projectId: number): Promise<void> {
    await this.projects.softDelete(projectId);
  }

  @Post(':projectId/restore')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  restore(@Param('projectId', ParseIntPipe) projectId: number): Promise<Project> {
    return this.projects.restore(projectId);
  }
}
