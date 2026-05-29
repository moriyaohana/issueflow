import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { Project } from './entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UsersService } from '../users/users.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { actorOf } from '../audit-log/audit-log.helpers';
import { AuditAction } from '../common/enums/audit-action.enum';
import { EntityType } from '../common/enums/entity-type.enum';
import { entityNotFound } from '../common/errors/messages';

export interface ProjectCascadeHandler {
  cascadeSoftDeleteForProject(
    projectId: number,
    actorUserId: number | null,
  ): Promise<void>;
  cascadeRestoreForProject(
    projectId: number,
    actorUserId: number | null,
  ): Promise<void>;
}

@Injectable()
export class ProjectsService {
  private cascadeHandler: ProjectCascadeHandler | null = null;

  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly users: UsersService,
    private readonly audit: AuditLogService,
  ) {}

  setCascadeHandler(handler: ProjectCascadeHandler): void {
    this.cascadeHandler = handler;
  }

  async create(
    dto: CreateProjectDto,
    actorUserId: number | null = null,
  ): Promise<Project> {
    await this.users.assertActive(dto.ownerId);

    const project = this.projects.create({
      name: dto.name,
      description: dto.description,
      ownerId: dto.ownerId,
    });
    const saved = await this.projects.save(project);
    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: EntityType.PROJECT,
      entityId: saved.id,
      ...actorOf(actorUserId),
    });
    return saved;
  }

  findAll(): Promise<Project[]> {
    return this.projects.find({ where: { deletedAt: IsNull() } });
  }

  async findOne(id: number): Promise<Project> {
    const project = await this.projects.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!project) {
      throw new NotFoundException(entityNotFound(EntityType.PROJECT, id));
    }
    return project;
  }

  async findAllDeleted(): Promise<Project[]> {
    return this.projects.find({
      where: { deletedAt: Not(IsNull()) },
      withDeleted: true,
    });
  }

  async update(
    id: number,
    dto: UpdateProjectDto,
    actorUserId: number | null = null,
  ): Promise<Project> {
    const project = await this.findOne(id);
    if (Object.keys(dto).length === 0) {
      return project;
    }
    if (dto.name !== undefined) project.name = dto.name;
    if (dto.description !== undefined) project.description = dto.description;
    const saved = await this.projects.save(project);
    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: EntityType.PROJECT,
      entityId: saved.id,
      ...actorOf(actorUserId),
    });
    return saved;
  }

  async softDelete(
    id: number,
    actorUserId: number | null = null,
  ): Promise<void> {
    const project = await this.findOne(id);
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Project).softRemove(project);
      await this.audit.record({
        action: AuditAction.DELETE,
        entityType: EntityType.PROJECT,
        entityId: project.id,
        ...actorOf(actorUserId),
      });
      if (this.cascadeHandler) {
        await this.cascadeHandler.cascadeSoftDeleteForProject(
          project.id,
          actorUserId,
        );
      }
    });
  }

  async restore(
    id: number,
    actorUserId: number | null = null,
  ): Promise<Project> {
    const project = await this.projects.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!project) {
      throw new NotFoundException(entityNotFound(EntityType.PROJECT, id));
    }
    if (!project.deletedAt) {
      return project;
    }
    await this.projects.restore(id);
    await this.audit.record({
      action: AuditAction.RESTORE,
      entityType: EntityType.PROJECT,
      entityId: project.id,
      ...actorOf(actorUserId),
    });
    if (this.cascadeHandler) {
      await this.cascadeHandler.cascadeRestoreForProject(
        project.id,
        actorUserId,
      );
    }
    const restored = await this.projects.findOne({ where: { id } });
    if (!restored) {
      throw new NotFoundException(entityNotFound(EntityType.PROJECT, id));
    }
    return restored;
  }

  async existsAndActive(id: number): Promise<boolean> {
    const count = await this.projects.count({
      where: { id, deletedAt: IsNull() },
    });
    return count > 0;
  }

  async assertActive(id: number): Promise<void> {
    if (!(await this.existsAndActive(id))) {
      throw new NotFoundException(entityNotFound(EntityType.PROJECT, id));
    }
  }

  async existsIncludingDeleted(id: number): Promise<boolean> {
    const count = await this.projects.count({
      where: { id },
      withDeleted: true,
    });
    return count > 0;
  }
}
