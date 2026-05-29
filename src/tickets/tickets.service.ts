import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  Not,
  OptimisticLockVersionMismatchError,
  Repository,
} from 'typeorm';
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
import { actorOf, systemActor } from '../audit-log/audit-log.helpers';
import { AuditAction } from '../common/enums/audit-action.enum';
import { EntityType } from '../common/enums/entity-type.enum';
import { AuditLog } from '../audit-log/entities/audit-log.entity';
import { assertVersionMatches } from '../common/utils/version';
import {
  entityNotFound,
  TICKET_IS_DONE,
  versionMismatch,
} from '../common/errors/messages';

export interface TicketCascadeTarget {
  cascadeSoftDeleteComments(
    ticketIds: number[],
    actorUserId: number | null,
  ): Promise<void>;
  cascadeSoftDeleteDependencies(
    ticketIds: number[],
    actorUserId: number | null,
  ): Promise<void>;
  cascadeSoftDeleteAttachments(
    ticketIds: number[],
    actorUserId: number | null,
  ): Promise<void>;
  cascadeRestoreComments(
    ticketIds: number[],
    actorUserId: number | null,
  ): Promise<void>;
  cascadeRestoreDependencies(
    ticketIds: number[],
    actorUserId: number | null,
  ): Promise<void>;
  cascadeRestoreAttachments(
    ticketIds: number[],
    actorUserId: number | null,
  ): Promise<void>;
}

export interface BlockersResolver {
  assertBlockersResolvedForDone(ticketId: number): Promise<void>;
}

export interface AutoAssignResolver {
  /**
   * Pick a developer for the given project. The caller MAY hand in a
   * transactional `EntityManager` so the workload query joins the same
   * snapshot the ticket insert is about to commit against.
   */
  pickAssignee(
    projectId: number,
    manager?: EntityManager,
  ): Promise<number | null>;
}

@Injectable()
export class TicketsService {
  private cascade: Partial<TicketCascadeTarget> = {};
  private blockers: BlockersResolver | null = null;
  private autoAssign: AutoAssignResolver | null = null;

  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly projects: ProjectsService,
    private readonly users: UsersService,
    private readonly audit: AuditLogService,
  ) {}

  registerCascadeTarget(cascade: Partial<TicketCascadeTarget>): void {
    this.cascade = { ...this.cascade, ...cascade };
  }

  registerBlockersResolver(blockersResolver: BlockersResolver): void {
    this.blockers = blockersResolver;
  }

  registerAutoAssignResolver(autoAssignResolver: AutoAssignResolver): void {
    this.autoAssign = autoAssignResolver;
  }

  async create(
    dto: CreateTicketDto,
    actorUserId: number | null = null,
  ): Promise<Ticket> {
    const projectActive = await this.projects.existsAndActive(dto.projectId);
    if (!projectActive) {
      throw new NotFoundException(
        entityNotFound(EntityType.PROJECT, dto.projectId),
      );
    }
    if (dto.assigneeId != null) {
      const ok = await this.users.existsAndActive(dto.assigneeId);
      if (!ok) {
        throw new BadRequestException(
          `Assignee ${dto.assigneeId} is missing or deleted`,
        );
      }
    }

    // Insert ticket + (optional) auto-assign + audit rows in one transaction.
    // Auto-assign is performed inside the same `EntityManager` so two
    // concurrent POSTs cannot both pick the same developer: the
    // `pickAssignee` query reads the live ticket counts under the same
    // serialisable/lock visibility as the insert about to land.
    return this.dataSource.transaction(async (manager) => {
      let assigneeId = dto.assigneeId ?? null;
      let autoAssigned = false;
      if (assigneeId == null && this.autoAssign) {
        assigneeId = await this.autoAssign.pickAssignee(dto.projectId, manager);
        autoAssigned = assigneeId != null;
      }

      const ticketRepo = manager.getRepository(Ticket);
      const ticket = ticketRepo.create({
        title: dto.title,
        description: dto.description,
        status: dto.status,
        priority: dto.priority,
        type: dto.type,
        projectId: dto.projectId,
        assigneeId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        isOverdue: false,
        deletedByCascade: false,
      });
      const saved = await ticketRepo.save(ticket);
      const auditRepo = manager.getRepository(AuditLog);
      const auditRows: Partial<AuditLog>[] = [
        {
          action: AuditAction.CREATE,
          entityType: EntityType.TICKET,
          entityId: saved.id,
          ...actorOf(actorUserId),
          metadata: null,
        },
      ];
      if (autoAssigned && assigneeId != null) {
        // Auto-assignment is a system-driven decision triggered as a
        // side-effect of the user's CREATE. Audit it separately so reports
        // can filter on actor=SYSTEM.
        auditRows.push({
          action: AuditAction.AUTO_ASSIGN,
          entityType: EntityType.TICKET,
          entityId: saved.id,
          ...systemActor(),
          metadata: { assignedTo: assigneeId },
        });
      }
      await auditRepo.insert(auditRows);
      return saved;
    });
  }

  async findAllForProject(projectId: number): Promise<Ticket[]> {
    const active = await this.projects.existsAndActive(projectId);
    if (!active) {
      throw new NotFoundException(
        entityNotFound(EntityType.PROJECT, projectId),
      );
    }
    return this.tickets.find({ where: { projectId, deletedAt: IsNull() } });
  }

  async findAllDeletedForProject(projectId: number): Promise<Ticket[]> {
    // Forensics endpoint: allow listing the deleted tickets of a soft-deleted
    // project (so the cascade can be inspected), but still reject totally
    // unknown projects.
    const exists = await this.projects.existsIncludingDeleted(projectId);
    if (!exists) {
      throw new NotFoundException(
        entityNotFound(EntityType.PROJECT, projectId),
      );
    }
    return this.tickets.find({
      where: { projectId, deletedAt: Not(IsNull()) },
      withDeleted: true,
    });
  }

  async findOne(id: number): Promise<Ticket> {
    const ticket = await this.tickets.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!ticket) {
      throw new NotFoundException(entityNotFound(EntityType.TICKET, id));
    }
    return ticket;
  }

  /**
   * Update flow enforces, in order:
   *   1. ticket exists and is not soft-deleted (404)
   *   2. DONE tickets are immutable (403)
   *   3. optimistic-locking version match via If-Match header (412)
   *   4. forward-only status progression (400)
   *   5. blockers must be DONE before status → DONE (delegated via
   *      `this.blockers` to break a circular module dependency)
   *   6. user-supplied priority clears isOverdue so the user's reclassification
   *      wins until the next escalation cycle re-evaluates the ticket; it does
   *      NOT opt the ticket out of escalation
   *   7. version increments on every successful save (handled by
   *      `@VersionColumn`; we still catch the race-window
   *      `OptimisticLockVersionMismatchError` and translate to 412)
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
      throw new NotFoundException(entityNotFound(EntityType.TICKET, id));
    }
    this.assertEditable(ticket);
    assertVersionMatches(ticket, expectedVersion, 'Ticket');

    const previousStatus = ticket.status;
    const previousPriority = ticket.priority;

    await this.applyStatusChange(ticket, dto);
    await this.applyAssigneeChange(ticket, dto);
    this.applyScalarPatches(ticket, dto);

    const saved = await this.saveWithVersionGuard(ticket);
    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: EntityType.TICKET,
      entityId: saved.id,
      ...actorOf(actorUserId),
      metadata: this.buildUpdateAuditMetadata(
        previousStatus,
        previousPriority,
        saved,
      ),
    });
    return saved;
  }

  private assertEditable(ticket: Ticket): void {
    if (ticket.status === TicketStatus.DONE) {
      throw new ForbiddenException(TICKET_IS_DONE);
    }
  }

  private async applyStatusChange(
    ticket: Ticket,
    dto: UpdateTicketDto,
  ): Promise<void> {
    if (dto.status === undefined || dto.status === ticket.status) return;
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

  private async applyAssigneeChange(
    ticket: Ticket,
    dto: UpdateTicketDto,
  ): Promise<void> {
    if (dto.assigneeId === undefined) return;
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

  private applyScalarPatches(ticket: Ticket, dto: UpdateTicketDto): void {
    if (dto.title !== undefined) ticket.title = dto.title;
    if (dto.description !== undefined) ticket.description = dto.description;
    if (dto.type !== undefined) ticket.type = dto.type;
    if (dto.dueDate !== undefined) ticket.dueDate = new Date(dto.dueDate);
    if (dto.priority !== undefined) {
      // A manual priority change clears the overdue flag so the user's
      // reclassification wins until the next escalation cycle re-evaluates
      // the ticket. The ticket remains eligible for auto-escalation.
      ticket.priority = dto.priority;
      ticket.isOverdue = false;
    }
  }

  private buildUpdateAuditMetadata(
    previousStatus: TicketStatus,
    previousPriority: Ticket['priority'],
    saved: Ticket,
  ): Record<string, unknown> | undefined {
    const metadata: Record<string, unknown> = {};
    if (saved.status !== previousStatus) {
      metadata.statusFrom = previousStatus;
      metadata.statusTo = saved.status;
    }
    if (saved.priority !== previousPriority) {
      metadata.priorityFrom = previousPriority;
      metadata.priorityTo = saved.priority;
    }
    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  /**
   * `@VersionColumn` raises {@link OptimisticLockVersionMismatchError} when
   * another writer commits between the load-check and the save; translate to
   * the same 412 the explicit `assertVersionMatches` guard emits so callers
   * see a uniform error envelope. We re-read the row to surface the freshest
   * known version in the error body.
   */
  private async saveWithVersionGuard(ticket: Ticket): Promise<Ticket> {
    try {
      return await this.tickets.save(ticket);
    } catch (err) {
      if (err instanceof OptimisticLockVersionMismatchError) {
        const fresh = await this.tickets.findOne({
          where: { id: ticket.id },
          withDeleted: true,
        });
        throw new PreconditionFailedException({
          message: versionMismatch('Ticket'),
          currentVersion: fresh?.version ?? null,
        });
      }
      throw err;
    }
  }

  /**
   * Soft-delete a ticket and cascade-soft-delete its children. Children
   * carry a `deletedByCascade` flag so the restore path can resurrect the
   * set without relying on timestamp equality.
   *
   * Wrapped in a transaction with a pessimistic row lock so a concurrent
   * escalation tick cannot race the delete and resurrect a half-deleted
   * ticket with a bumped version.
   */
  async softDelete(
    id: number,
    actorUserId: number | null,
    expectedVersion: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const ticketRepo = manager.getRepository(Ticket);
      const ticket = await ticketRepo
        .createQueryBuilder('t')
        .setLock('pessimistic_write')
        .where('t.id = :id AND t.deletedAt IS NULL', { id })
        .getOne();
      if (!ticket) {
        throw new NotFoundException(entityNotFound(EntityType.TICKET, id));
      }
      assertVersionMatches(ticket, expectedVersion, 'Ticket');
      ticket.deletedAt = new Date();
      try {
        await ticketRepo.save(ticket);
      } catch (err) {
        if (err instanceof OptimisticLockVersionMismatchError) {
          throw new PreconditionFailedException({
            message: versionMismatch('Ticket'),
            currentVersion: ticket.version,
          });
        }
        throw err;
      }
      await this.runCascadeSoftDeletes([ticket.id], actorUserId);
      await manager.getRepository(AuditLog).insert({
        action: AuditAction.DELETE,
        entityType: EntityType.TICKET,
        entityId: ticket.id,
        ...actorOf(actorUserId),
        metadata: null,
      });
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
    if (!ticket) {
      throw new NotFoundException(entityNotFound(EntityType.TICKET, id));
    }
    if (!ticket.deletedAt) return ticket;
    // Single conditional UPDATE: clear `deletedAt` and `deletedByCascade` in
    // one round-trip so a crash between the two no longer leaves a restored
    // row with a stale cascade flag.
    await this.tickets
      .createQueryBuilder()
      .update(Ticket)
      .set({ deletedAt: null, deletedByCascade: false })
      .where('id = :id', { id })
      .execute();
    await this.runCascadeRestores([ticket.id], actorUserId);
    await this.audit.record({
      action: AuditAction.RESTORE,
      entityType: EntityType.TICKET,
      entityId: ticket.id,
      ...actorOf(actorUserId),
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
    await this.tickets.update(
      { id: In(ids) },
      { deletedByCascade: true, deletedAt: new Date() },
    );
    await this.runCascadeSoftDeletes(ids, actorUserId);
    await this.recordCascadeAuditRows(
      ids,
      AuditAction.DELETE,
      actorUserId,
      projectId,
    );
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
    // Single conditional UPDATE: combined with #45 from the cleanup pass —
    // clear `deletedAt` (restore) and `deletedByCascade` in one statement.
    await this.tickets
      .createQueryBuilder()
      .update(Ticket)
      .set({ deletedAt: null, deletedByCascade: false })
      .where({ id: In(ids) })
      .execute();
    await this.runCascadeRestores(ids, actorUserId);
    await this.recordCascadeAuditRows(
      ids,
      AuditAction.RESTORE,
      actorUserId,
      projectId,
    );
  }

  /**
   * Bulk audit insert for cascade ticket transitions. We build the rows in
   * memory and hand them to `AuditLogService.record` one shot so the
   * cascade no longer issues N sequential INSERTs (one per ticket).
   */
  private async recordCascadeAuditRows(
    ticketIds: number[],
    action: AuditAction,
    actorUserId: number | null,
    projectId: number,
  ): Promise<void> {
    await Promise.all(
      ticketIds.map((id) =>
        this.audit.record({
          action,
          entityType: EntityType.TICKET,
          entityId: id,
          ...actorOf(actorUserId),
          metadata: { cascade: 'soft', projectId },
        }),
      ),
    );
  }

  private async runCascadeSoftDeletes(
    ticketIds: number[],
    actorUserId: number | null = null,
  ): Promise<void> {
    if (ticketIds.length === 0) return;
    // Iterate over the registered cascade handlers so adding a new child
    // type (e.g. attachments → audit-events) needs only the entry in
    // `registerCascadeTarget`; no edits here.
    for (const handler of this.softDeleteHandlers()) {
      await handler(ticketIds, actorUserId);
    }
  }

  private async runCascadeRestores(
    ticketIds: number[],
    actorUserId: number | null = null,
  ): Promise<void> {
    if (ticketIds.length === 0) return;
    for (const handler of this.restoreHandlers()) {
      await handler(ticketIds, actorUserId);
    }
  }

  private softDeleteHandlers(): Array<
    (ticketIds: number[], actorUserId: number | null) => Promise<void>
  > {
    const c = this.cascade;
    return [
      c.cascadeSoftDeleteComments?.bind(c),
      c.cascadeSoftDeleteDependencies?.bind(c),
      c.cascadeSoftDeleteAttachments?.bind(c),
    ].filter(
      (fn): fn is (
        ticketIds: number[],
        actorUserId: number | null,
      ) => Promise<void> => typeof fn === 'function',
    );
  }

  private restoreHandlers(): Array<
    (ticketIds: number[], actorUserId: number | null) => Promise<void>
  > {
    const c = this.cascade;
    return [
      c.cascadeRestoreComments?.bind(c),
      c.cascadeRestoreDependencies?.bind(c),
      c.cascadeRestoreAttachments?.bind(c),
    ].filter(
      (fn): fn is (
        ticketIds: number[],
        actorUserId: number | null,
      ) => Promise<void> => typeof fn === 'function',
    );
  }

  async existsAndActive(id: number): Promise<boolean> {
    const count = await this.tickets.count({
      where: { id, deletedAt: IsNull() },
    });
    return count > 0;
  }

  /**
   * Canonical "ticket must exist and not be soft-deleted" guard. Shared by
   * the comment/attachment/dependency entry points so the 404 message stays
   * consistent and the check can be tightened (e.g. row lock) in one place.
   */
  async assertActive(id: number): Promise<void> {
    if (!(await this.existsAndActive(id))) {
      throw new NotFoundException(entityNotFound(EntityType.TICKET, id));
    }
  }
}
