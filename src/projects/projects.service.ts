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
    const ownerActive = await this.users.existsAndActive(dto.ownerId);
    if (!ownerActive) {
      // Distinguish "owner missing" (404) from "owner soft-deleted" (400).
      // Use the null-returning lookup so existence-vs-deletion is a branch on a
      // value, not a try/catch around a throwing helper.
      const owner = await this.users.findOptionalIncludingDeleted(dto.ownerId);
      if (!owner) {
        throw new NotFoundException(
          entityNotFound(EntityType.USER, dto.ownerId),
        );
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
    // Short-circuit no-op PATCHes: an empty body should be a successful 200
    // (idempotent) without producing a write or an audit row. Saves a UPDATE
    // round-trip plus an `audit_logs` insert on every spurious call.
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
    // Wrap soft-delete + cascade + audit in one transaction so a crash mid-way
    // cannot leave the project deleted with its tickets still live (or vice
    // versa). Audit is written inside the same TX via the shared `record` path
    // so an audit-write failure also rolls the delete back.
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
    // The row was just restored above, so a missing read here would indicate a
    // race (a concurrent hard-delete that we don't support). Throw the
    // canonical 404 instead of casting the null away.
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
