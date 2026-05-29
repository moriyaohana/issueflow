import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { TicketDependency } from './entities/ticket-dependency.entity';
import { Ticket } from '../entities/ticket.entity';
import { TicketsService } from '../tickets.service';
import { TicketStatus } from '../../common/enums/ticket-status.enum';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { actorOf } from '../../audit-log/audit-log.helpers';
import { AuditAction } from '../../common/enums/audit-action.enum';
import { EntityType } from '../../common/enums/entity-type.enum';
import { AuditLog } from '../../audit-log/entities/audit-log.entity';
import { liveOnly } from '../../common/utils/live-only';
import { entityNotFound } from '../../common/errors/messages';

@Injectable()
export class DependenciesService {
  constructor(
    @InjectRepository(TicketDependency)
    private readonly deps: Repository<TicketDependency>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ticketsService: TicketsService,
    private readonly audit: AuditLogService,
  ) {}

  async add(
    ticketId: number,
    blockedBy: number,
    actorUserId: number | null = null,
  ): Promise<void> {
    if (ticketId === blockedBy) {
      throw new BadRequestException('Ticket cannot depend on itself');
    }
    await this.dataSource.transaction(async (manager) => {
      const ticketRepo = manager.getRepository(Ticket);
      const depsRepo = manager.getRepository(TicketDependency);
      // Lock the parent row so concurrent inserts serialise; the blocker is
      // read non-locking — its identity/project is immutable.
      const ticket = await ticketRepo
        .createQueryBuilder('t')
        .setLock('pessimistic_write')
        .where('t.id = :id AND t.deletedAt IS NULL', { id: ticketId })
        .getOne();
      if (!ticket) {
        throw new NotFoundException(
          entityNotFound(EntityType.TICKET, ticketId),
        );
      }
      const blocker = await ticketRepo.findOne({
        where: { id: blockedBy, deletedAt: IsNull() },
      });
      if (!blocker) {
        throw new NotFoundException(
          entityNotFound(EntityType.TICKET, blockedBy),
        );
      }
      if (ticket.projectId !== blocker.projectId) {
        throw new BadRequestException(
          'Dependencies must be within the same project',
        );
      }
      const existing = await depsRepo.findOne({
        where: liveOnly<TicketDependency>({ ticketId, blockedBy }),
      });
      if (existing) {
        throw new ConflictException('Dependency already exists');
      }
      await depsRepo.insert({ ticketId, blockedBy });
      await manager.getRepository(AuditLog).insert({
        action: AuditAction.CREATE,
        entityType: EntityType.TICKET,
        entityId: ticketId,
        ...actorOf(actorUserId),
        metadata: { blockedBy },
      });
    });
  }

  async list(
    ticketId: number,
  ): Promise<{ id: number; title: string; status: TicketStatus }[]> {
    await this.ticketsService.assertActive(ticketId);
    const rows = await this.deps.find({
      where: liveOnly<TicketDependency>({ ticketId }),
    });
    if (rows.length === 0) return [];
    const blockers = await this.tickets.find({
      where: liveOnly<Ticket>({ id: In(rows.map((r) => r.blockedBy)) }),
      select: ['id', 'title', 'status'],
    });
    return blockers.map((b) => ({
      id: b.id,
      title: b.title,
      status: b.status,
    }));
  }

  async remove(
    ticketId: number,
    blockedBy: number,
    actorUserId: number | null = null,
  ): Promise<void> {
    const ticket = await this.tickets.findOne({
      where: liveOnly<Ticket>({ id: ticketId }),
    });
    if (!ticket) {
      throw new NotFoundException(entityNotFound(EntityType.TICKET, ticketId));
    }
    const dep = await this.deps.findOne({
      where: liveOnly<TicketDependency>({ ticketId, blockedBy }),
    });
    if (!dep) throw new NotFoundException(`Dependency not found`);
    await this.deps.delete({ id: dep.id });
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: EntityType.TICKET,
      entityId: ticketId,
      ...actorOf(actorUserId),
      metadata: { blockedBy },
    });
  }

  async assertBlockersResolvedForDone(ticketId: number): Promise<void> {
    const deps = await this.deps.find({
      where: { ticketId, deletedAt: IsNull() },
    });
    if (deps.length === 0) return;
    const blockers = await this.tickets.find({
      where: liveOnly<Ticket>({ id: In(deps.map((d) => d.blockedBy)) }),
    });
    const unresolved = blockers
      .filter((b) => b.status !== TicketStatus.DONE)
      .map((b) => b.id);
    if (unresolved.length > 0) {
      throw new ConflictException({
        message: 'Unresolved blockers prevent DONE transition',
        unresolvedBlockers: unresolved,
      });
    }
  }

  async cascadeSoftDeleteDependencies(
    ticketIds: number[],
    actorUserId: number | null = null,
  ): Promise<void> {
    if (ticketIds.length === 0) return;
    const rows = await this.deps
      .createQueryBuilder('d')
      .select(['d.id', 'd.ticketId', 'd.blockedBy'])
      .where(
        '(d.ticketId IN (:...ids) OR d.blockedBy IN (:...ids)) AND d.deletedAt IS NULL',
        { ids: ticketIds },
      )
      .getMany();
    if (rows.length === 0) return;
    await this.deps
      .createQueryBuilder()
      .update(TicketDependency)
      .set({ deletedAt: new Date(), deletedByCascade: true })
      .where('id IN (:...ids)', { ids: rows.map((r) => r.id) })
      .execute();
    for (const r of rows) {
      await this.audit.record({
        action: AuditAction.DELETE,
        entityType: EntityType.DEPENDENCY,
        entityId: r.id,
        ...actorOf(actorUserId),
        metadata: { cascade: 'soft', ticketIds },
      });
    }
  }

  async cascadeRestoreDependencies(
    ticketIds: number[],
    actorUserId: number | null = null,
  ): Promise<void> {
    if (ticketIds.length === 0) return;
    const rows = await this.deps
      .createQueryBuilder('d')
      .select(['d.id'])
      .where(
        '(d.ticketId IN (:...ids) OR d.blockedBy IN (:...ids)) AND d.deletedByCascade = TRUE',
        { ids: ticketIds },
      )
      .withDeleted()
      .getMany();
    if (rows.length === 0) return;
    await this.deps
      .createQueryBuilder()
      .update(TicketDependency)
      .set({ deletedAt: null, deletedByCascade: false })
      .where('id IN (:...ids)', { ids: rows.map((r) => r.id) })
      .execute();
    for (const r of rows) {
      await this.audit.record({
        action: AuditAction.RESTORE,
        entityType: EntityType.DEPENDENCY,
        entityId: r.id,
        ...actorOf(actorUserId),
        metadata: { cascade: 'soft', ticketIds },
      });
    }
  }
}
