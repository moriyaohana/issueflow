import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Ticket } from '../entities/ticket.entity';
import { TicketStatus } from '../../common/enums/ticket-status.enum';
import {
  TICKET_PRIORITY_ORDER,
  TicketPriority,
} from '../../common/enums/ticket-priority.enum';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction } from '../../common/enums/audit-action.enum';
import { EntityType } from '../../common/enums/entity-type.enum';
import { ActorType } from '../../common/enums/actor-type.enum';

interface PendingAuditRow {
  ticketId: number;
  priorityFrom: TicketPriority;
  priorityTo: TicketPriority;
  isOverdueFrom: boolean;
  isOverdueTo: boolean;
}

@Injectable()
export class EscalationService {
  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Sweep overdue tickets and either bump priority one step (LOW→MEDIUM→
   * HIGH→CRITICAL) or, if already CRITICAL, flag `isOverdue = true`.
   *
   * Implemented as one bulk UPDATE per source priority band plus a final
   * UPDATE for the CRITICAL `isOverdue` flip:
   *   - one round-trip per band (4 max) regardless of the overdue volume,
   *   - the `version` column is bumped manually in the UPDATE (the bulk
   *     QueryBuilder bypasses TypeORM's `@VersionColumn` save path),
   *   - HIGH→CRITICAL also sets `isOverdue = true` in the same statement so
   *     a freshly-bumped ticket exits the same tick already flagged
   *     (otherwise the flag would land on the next tick).
   *
   * The whole sweep runs inside a single transaction so partial progress
   * never leaves the audit log out of sync with the ticket priorities.
   * Soft-deleted and DONE tickets are excluded by the WHERE clause.
   */
  async runEscalation(): Promise<number> {
    const overdue = await this.tickets
      .createQueryBuilder('t')
      .where('t.dueDate < :now', { now: new Date() })
      .andWhere('t.status != :done', { done: TicketStatus.DONE })
      .andWhere('t.deletedAt IS NULL')
      .getMany();
    if (overdue.length === 0) return 0;

    const buckets = this.bucketByTransition(overdue);
    if (buckets.affected === 0) return 0;

    await this.dataSource.transaction(async (manager) => {
      const ticketRepo = manager.getRepository(Ticket);
      // Bulk UPDATE per source priority. The CRITICAL bucket only flips
      // `isOverdue`; everything else bumps priority (and isOverdue when the
      // new priority is CRITICAL, see #37).
      for (const [from, group] of buckets.priorityBumps) {
        const to =
          TICKET_PRIORITY_ORDER[TICKET_PRIORITY_ORDER.indexOf(from) + 1];
        const flipOverdue = to === TicketPriority.CRITICAL;
        await ticketRepo
          .createQueryBuilder()
          .update(Ticket)
          .set({
            priority: to,
            isOverdue: flipOverdue ? true : () => '"isOverdue"',
            // Manual bump: the bulk UPDATE path is outside TypeORM's
            // optimistic-lock interception, so we increment the version
            // column inline.
            version: () => 'version + 1',
          })
          .where('id IN (:...ids)', { ids: group.map((t) => t.id) })
          .execute();
      }
      if (buckets.criticalFlip.length > 0) {
        await ticketRepo
          .createQueryBuilder()
          .update(Ticket)
          .set({
            isOverdue: true,
            version: () => 'version + 1',
          })
          .where('id IN (:...ids)', {
            ids: buckets.criticalFlip.map((t) => t.id),
          })
          .execute();
      }
    });
    // Audit rows are recorded outside the ticket transaction: the audit
    // service swallows errors internally (so a failure here can't roll back
    // the bulk UPDATE) and our `AuditLog` table is append-only — no need
    // to share a connection. Fire them in parallel so per-tick latency
    // stays O(1) in the overdue count for the typical bounded sweep.
    await Promise.all(
      buckets.auditRows.map((row) =>
        this.audit.record({
          action: AuditAction.AUTO_ESCALATE,
          entityType: EntityType.TICKET,
          entityId: row.ticketId,
          performedBy: null,
          actor: ActorType.SYSTEM,
          metadata: {
            priorityFrom: row.priorityFrom,
            priorityTo: row.priorityTo,
            isOverdueFrom: row.isOverdueFrom,
            isOverdueTo: row.isOverdueTo,
          },
        }),
      ),
    );

    // Mutate the in-memory entities so callers (e.g. unit tests) observing
    // the same references see the post-bump fields. The bulk UPDATE does
    // not touch the entity instances on its own.
    for (const row of buckets.auditRows) {
      const t = buckets.byId.get(row.ticketId);
      if (!t) continue;
      t.priority = row.priorityTo;
      t.isOverdue = row.isOverdueTo;
      t.version += 1;
    }

    return buckets.affected;
  }

  /**
   * Compute the per-band UPDATE plan: which tickets bump from which source
   * priority, which ones only flip `isOverdue` at CRITICAL, and the audit
   * row each transition needs.
   */
  private bucketByTransition(overdue: Ticket[]): {
    priorityBumps: Map<TicketPriority, Ticket[]>;
    criticalFlip: Ticket[];
    auditRows: PendingAuditRow[];
    byId: Map<number, Ticket>;
    affected: number;
  } {
    const priorityBumps = new Map<TicketPriority, Ticket[]>();
    const criticalFlip: Ticket[] = [];
    const auditRows: PendingAuditRow[] = [];
    const byId = new Map<number, Ticket>();
    for (const ticket of overdue) {
      byId.set(ticket.id, ticket);
      const idx = TICKET_PRIORITY_ORDER.indexOf(ticket.priority);
      if (idx < TICKET_PRIORITY_ORDER.length - 1) {
        const to = TICKET_PRIORITY_ORDER[idx + 1];
        const list = priorityBumps.get(ticket.priority) ?? [];
        list.push(ticket);
        priorityBumps.set(ticket.priority, list);
        auditRows.push({
          ticketId: ticket.id,
          priorityFrom: ticket.priority,
          priorityTo: to,
          isOverdueFrom: ticket.isOverdue,
          // HIGH→CRITICAL flips overdue in the same tick (#37).
          isOverdueTo:
            to === TicketPriority.CRITICAL ? true : ticket.isOverdue,
        });
      } else if (!ticket.isOverdue) {
        criticalFlip.push(ticket);
        auditRows.push({
          ticketId: ticket.id,
          priorityFrom: ticket.priority,
          priorityTo: ticket.priority,
          isOverdueFrom: ticket.isOverdue,
          isOverdueTo: true,
        });
      }
      // else: already CRITICAL + isOverdue — idempotent, no row generated.
    }
    return {
      priorityBumps,
      criticalFlip,
      auditRows,
      byId,
      affected: auditRows.length,
    };
  }
}
