import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Ticket } from './entities/ticket.entity';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import {
  TicketStatus,
  TICKET_STATUS_ORDER,
} from '../common/enums/ticket-status.enum';
import { ProjectsService } from '../projects/projects.service';
import { UsersService } from '../users/users.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../common/enums/audit-action.enum';
import { EntityType } from '../common/enums/entity-type.enum';
import { ActorType } from '../common/enums/actor-type.enum';

export interface TicketCascadeTarget {
  cascadeHardDeleteComments(
    ticketIds: number[],
    actorUserId: number | null,
  ): Promise<void>;
  cascadeHardDeleteDependencies(ticketIds: number[]): Promise<void>;
  cascadeHardDeleteAttachments(
    ticketIds: number[],
    actorUserId: number | null,
  ): Promise<void>;
}

export interface BlockersResolver {
  assertBlockersResolvedForDone(ticketId: number): Promise<void>;
}

export interface AutoAssignResolver {
  pickAssignee(projectId: number): Promise<number | null>;
}

@Injectable()
export class TicketsService {
  private cascade: Partial<TicketCascadeTarget> = {};
  private blockers: BlockersResolver | null = null;
  private autoAssign: AutoAssignResolver | null = null;

  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    private readonly projects: ProjectsService,
    private readonly users: UsersService,
    private readonly audit: AuditLogService,
  ) {}

  registerCascadeTarget(t: Partial<TicketCascadeTarget>): void {
    this.cascade = { ...this.cascade, ...t };
  }

  registerBlockersResolver(b: BlockersResolver): void {
    this.blockers = b;
  }

  registerAutoAssignResolver(a: AutoAssignResolver): void {
    this.autoAssign = a;
  }

  async create(
    dto: CreateTicketDto,
    actorUserId: number | null = null,
  ): Promise<Ticket> {
    const projectActive = await this.projects.existsAndActive(dto.projectId);
    if (!projectActive) {
      throw new NotFoundException(`Project ${dto.projectId} not found`);
    }
    if (dto.assigneeId != null) {
      const ok = await this.users.existsAndActive(dto.assigneeId);
      if (!ok) {
        throw new BadRequestException(
          `Assignee ${dto.assigneeId} is missing or deleted`,
        );
      }
    }

    let assigneeId = dto.assigneeId ?? null;
    let autoAssigned = false;
    if (assigneeId == null && this.autoAssign) {
      assigneeId = await this.autoAssign.pickAssignee(dto.projectId);
      autoAssigned = assigneeId != null;
    }

    const ticket = this.tickets.create({
      title: dto.title,
      description: dto.description,
      status: dto.status,
      priority: dto.priority,
      type: dto.type,
      projectId: dto.projectId,
      assigneeId,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      version: 1,
      isOverdue: false,
      autoEscalationPaused: false,
      deletedByCascade: false,
    });
    const saved = await this.tickets.save(ticket);
    await this.audit.record({
      action: AuditAction.TICKET_CREATE,
      entityType: EntityType.TICKET,
      entityId: saved.id,
      performedBy: actorUserId,
      actor: ActorType.USER,
    });
    if (autoAssigned && assigneeId != null) {
      // Auto-assignment is a system-driven decision triggered as a side-effect
      // of the user's CREATE. Audit it separately so reports can filter on
      // actor=SYSTEM.
      await this.audit.record({
        action: AuditAction.AUTO_ASSIGN,
        entityType: EntityType.TICKET,
        entityId: saved.id,
        performedBy: null,
        actor: ActorType.SYSTEM,
        metadata: { assignedTo: assigneeId },
      });
    }
    return saved;
  }

  findAllForProject(projectId: number): Promise<Ticket[]> {
    return this.tickets.find({ where: { projectId, deletedAt: IsNull() } });
  }

  findAllDeletedForProject(projectId: number): Promise<Ticket[]> {
    return this.tickets.find({
      where: { projectId, deletedAt: Not(IsNull()) },
      withDeleted: true,
    });
  }

  async findOne(id: number): Promise<Ticket> {
    const ticket = await this.tickets.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);
    return ticket;
  }

  /**
   * Update flow enforces, in order:
   *   1. ticket exists and is not soft-deleted (404)
   *   2. DONE tickets are immutable (403)
   *   3. optimistic-locking version match via If-Match header (412)
   *   4. forward-only status progression (400)
   *   5. blockers must be DONE before status → DONE (filled in Agent 8)
   *   6. user-supplied priority pauses auto-escalation and clears isOverdue
   *   7. version increments on every successful save
   *
   * `expectedVersion` is the integer parsed from the `If-Match` request
   * header; the missing-header case is rejected at the decorator layer
   * with 428 so this method only sees a number.
   */
  async update(
    id: number,
    dto: UpdateTicketDto,
    actorUserId: number | null,
    expectedVersion: number,
  ): Promise<Ticket> {
    const ticket = await this.tickets.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!ticket || ticket.deletedAt) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }
    if (ticket.status === TicketStatus.DONE) {
      throw new ForbiddenException('Ticket is DONE and cannot be modified');
    }
    if (expectedVersion !== ticket.version) {
      throw new PreconditionFailedException({
        message: 'Version mismatch',
        currentVersion: ticket.version,
      });
    }
    const previousStatus = ticket.status;
    const previousPriority = ticket.priority;
    if (dto.status !== undefined && dto.status !== ticket.status) {
      const currentIdx = TICKET_STATUS_ORDER.indexOf(ticket.status);
      const nextIdx = TICKET_STATUS_ORDER.indexOf(dto.status);
      if (nextIdx < currentIdx) {
        throw new BadRequestException(
          `Cannot move ticket status backwards from ${ticket.status} to ${dto.status}`,
        );
      }
      if (dto.status === TicketStatus.DONE && this.blockers) {
        await this.blockers.assertBlockersResolvedForDone(ticket.id);
      }
      ticket.status = dto.status;
    }
    if (dto.assigneeId !== undefined) {
      if (dto.assigneeId !== null) {
        const ok = await this.users.existsAndActive(dto.assigneeId);
        if (!ok) {
          throw new BadRequestException(
            `Assignee ${dto.assigneeId} is missing or deleted`,
          );
        }
      }
      ticket.assigneeId = dto.assigneeId;
    }
    if (dto.title !== undefined) ticket.title = dto.title;
    if (dto.description !== undefined) ticket.description = dto.description;
    if (dto.type !== undefined) ticket.type = dto.type;
    if (dto.dueDate !== undefined) ticket.dueDate = new Date(dto.dueDate);
    if (dto.priority !== undefined) {
      // A manual priority change pauses auto-escalation for the ticket and
      // clears the overdue flag so the user's classification wins until the
      // next time they explicitly opt in.
      ticket.priority = dto.priority;
      ticket.autoEscalationPaused = true;
      ticket.isOverdue = false;
    }
    ticket.version += 1;
    const saved = await this.tickets.save(ticket);
    const metadata: Record<string, unknown> = {};
    if (saved.status !== previousStatus) {
      metadata.statusFrom = previousStatus;
      metadata.statusTo = saved.status;
    }
    if (saved.priority !== previousPriority) {
      metadata.priorityFrom = previousPriority;
      metadata.priorityTo = saved.priority;
    }
    await this.audit.record({
      action: AuditAction.TICKET_UPDATE,
      entityType: EntityType.TICKET,
      entityId: saved.id,
      performedBy: actorUserId,
      actor: ActorType.USER,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
    return saved;
  }

  async softDelete(
    id: number,
    actorUserId: number | null,
    expectedVersion: number,
  ): Promise<void> {
    const ticket = await this.findOne(id);
    if (expectedVersion !== ticket.version) {
      throw new PreconditionFailedException({
        message: 'Version mismatch',
        currentVersion: ticket.version,
      });
    }
    await this.runCascadeDeletes([ticket.id], actorUserId);
    await this.tickets.softRemove(ticket);
    await this.audit.record({
      action: AuditAction.TICKET_DELETE,
      entityType: EntityType.TICKET,
      entityId: ticket.id,
      performedBy: actorUserId,
      actor: ActorType.USER,
    });
  }

  async restore(
    id: number,
    actorUserId: number | null = null,
  ): Promise<Ticket> {
    const ticket = await this.tickets.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);
    if (!ticket.deletedAt) return ticket;
    await this.tickets.restore(id);
    if (ticket.deletedByCascade) {
      ticket.deletedByCascade = false;
      await this.tickets.update(id, { deletedByCascade: false });
    }
    await this.audit.record({
      action: AuditAction.TICKET_RESTORE,
      entityType: EntityType.TICKET,
      entityId: ticket.id,
      performedBy: actorUserId,
      actor: ActorType.USER,
    });
    return this.tickets.findOne({ where: { id } }) as Promise<Ticket>;
  }

  /** Cascade hook fired by ProjectsService.softDelete. */
  async cascadeSoftDeleteForProject(
    projectId: number,
    actorUserId: number | null = null,
  ): Promise<void> {
    const tickets = await this.tickets.find({
      where: { projectId, deletedAt: IsNull() },
    });
    if (tickets.length === 0) return;
    const ids = tickets.map((t) => t.id);
    await this.tickets.update({ id: In(ids) }, { deletedByCascade: true });
    await this.runCascadeDeletes(ids, actorUserId);
    await this.tickets.softRemove(tickets);
    for (const t of tickets) {
      await this.audit.record({
        action: AuditAction.TICKET_DELETE,
        entityType: EntityType.TICKET,
        entityId: t.id,
        performedBy: actorUserId,
        actor: ActorType.USER,
        metadata: { cascade: true, projectId },
      });
    }
  }

  /** Cascade hook fired by ProjectsService.restore. */
  async cascadeRestoreForProject(
    projectId: number,
    actorUserId: number | null = null,
  ): Promise<void> {
    const candidates = await this.tickets.find({
      where: { projectId, deletedByCascade: true, deletedAt: Not(IsNull()) },
      withDeleted: true,
    });
    if (candidates.length === 0) return;
    const ids = candidates.map((t) => t.id);
    await this.tickets.restore({ id: In(ids) });
    await this.tickets.update({ id: In(ids) }, { deletedByCascade: false });
    for (const t of candidates) {
      await this.audit.record({
        action: AuditAction.TICKET_RESTORE,
        entityType: EntityType.TICKET,
        entityId: t.id,
        performedBy: actorUserId,
        actor: ActorType.USER,
        metadata: { cascade: true, projectId },
      });
    }
  }

  private async runCascadeDeletes(
    ticketIds: number[],
    actorUserId: number | null = null,
  ): Promise<void> {
    if (ticketIds.length === 0) return;
    if (this.cascade.cascadeHardDeleteComments) {
      await this.cascade.cascadeHardDeleteComments(ticketIds, actorUserId);
    }
    if (this.cascade.cascadeHardDeleteDependencies) {
      await this.cascade.cascadeHardDeleteDependencies(ticketIds);
    }
    if (this.cascade.cascadeHardDeleteAttachments) {
      await this.cascade.cascadeHardDeleteAttachments(ticketIds, actorUserId);
    }
  }

  async existsAndActive(id: number): Promise<boolean> {
    const count = await this.tickets.count({
      where: { id, deletedAt: IsNull() },
    });
    return count > 0;
  }
}
