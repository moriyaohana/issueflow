import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { Ticket } from '../entities/ticket.entity';
import { TicketStatus } from '../../common/enums/ticket-status.enum';
import { TICKET_PRIORITY_ORDER } from '../../common/enums/ticket-priority.enum';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction } from '../../common/enums/audit-action.enum';
import { EntityType } from '../../common/enums/entity-type.enum';
import { ActorType } from '../../common/enums/actor-type.enum';

@Injectable()
export class EscalationService {
  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Sweep overdue tickets and either bump priority one step (LOW→MEDIUM→
   * HIGH→CRITICAL) or, if already CRITICAL, flag `isOverdue = true`.
   *
   * - `autoEscalationPaused = true` opts a ticket out (user has taken manual
   *   control of priority).
   * - Each save bumps `version` so racing client PATCHes 409 cleanly.
   * - Soft-deleted and DONE tickets are excluded.
   * - At CRITICAL the operation is idempotent: only update when `isOverdue`
   *   actually flips.
   */
  async runEscalation(): Promise<number> {
    const overdue = await this.tickets.find({
      where: {
        dueDate: LessThan(new Date()) as unknown as Date,
        status: Not(TicketStatus.DONE) as unknown as TicketStatus,
        autoEscalationPaused: false,
        deletedAt: IsNull(),
      },
    });
    let affected = 0;
    for (const ticket of overdue) {
      if (!ticket.dueDate) continue;
      const idx = TICKET_PRIORITY_ORDER.indexOf(ticket.priority);
      const previousPriority = ticket.priority;
      const previousOverdue = ticket.isOverdue;
      if (idx < TICKET_PRIORITY_ORDER.length - 1) {
        ticket.priority = TICKET_PRIORITY_ORDER[idx + 1];
      } else if (!ticket.isOverdue) {
        ticket.isOverdue = true;
      } else {
        continue;
      }
      ticket.version += 1;
      await this.tickets.save(ticket);
      await this.audit.record({
        action: AuditAction.AUTO_ESCALATE,
        entityType: EntityType.TICKET,
        entityId: ticket.id,
        performedBy: null,
        actor: ActorType.SYSTEM,
        metadata: {
          priorityFrom: previousPriority,
          priorityTo: ticket.priority,
          isOverdueFrom: previousOverdue,
          isOverdueTo: ticket.isOverdue,
        },
      });
      affected++;
    }
    return affected;
  }
}
