import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Project } from './entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UsersService } from '../users/users.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { actorOf } from '../audit-log/audit-log.helpers';
import { AuditAction } from '../common/enums/audit-action.enum';
import { EntityType } from '../common/enums/entity-type.enum';

/**
 * Cascade hook contract: TicketsService (Agent 5) implements these and
 * registers itself via setCascadeHandler so ProjectsService can call them
 * without a hard module dependency.
 */
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
    const ownerActive = await this.users.existsAndActive(dto.ownerId);
    if (!ownerActive) {
      // Distinguish "owner missing" (404) from "owner soft-deleted" (400).
      const owner = await this.users
        .findOneIncludingDeleted(dto.ownerId)
        .catch(() => null);
      if (!owner) {
        throw new NotFoundException(`Owner user ${dto.ownerId} not found`);
      }
      throw new BadRequestException(`Owner user ${dto.ownerId} is deleted`);
    }
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
    if (!project) throw new NotFoundException(`Project ${id} not found`);
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
    await this.projects.softRemove(project);
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
  }

  async restore(
    id: number,
    actorUserId: number | null = null,
  ): Promise<Project> {
    const project = await this.projects.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
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
    return this.projects.findOne({ where: { id } }) as Promise<Project>;
  }

  async existsAndActive(id: number): Promise<boolean> {
    const count = await this.projects.count({
      where: { id, deletedAt: IsNull() },
    });
    return count > 0;
  }

  /**
   * Like {@link existsAndActive} but also returns true for soft-deleted
   * projects. Used by forensics-style endpoints (e.g. listing the cascade
   * trail under a soft-deleted project) that still need to reject totally
   * unknown FK ids.
   */
  async existsIncludingDeleted(id: number): Promise<boolean> {
    const count = await this.projects.count({
      where: { id },
      withDeleted: true,
    });
    return count > 0;
  }
}
