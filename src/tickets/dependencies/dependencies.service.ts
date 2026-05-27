import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { TicketDependency } from './entities/ticket-dependency.entity';
import { Ticket } from '../entities/ticket.entity';
import { TicketStatus } from '../../common/enums/ticket-status.enum';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction } from '../../common/enums/audit-action.enum';
import { EntityType } from '../../common/enums/entity-type.enum';
import { ActorType } from '../../common/enums/actor-type.enum';

@Injectable()
export class DependenciesService {
  constructor(
    @InjectRepository(TicketDependency)
    private readonly deps: Repository<TicketDependency>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    private readonly audit: AuditLogService,
  ) {}

  async add(
    ticketId: number,
    blockerId: number,
    actorUserId: number | null = null,
  ): Promise<void> {
    if (ticketId === blockerId) {
      throw new BadRequestException('Ticket cannot depend on itself');
    }
    const [ticket, blocker] = await Promise.all([
      this.tickets.findOne({ where: { id: ticketId, deletedAt: IsNull() } }),
      this.tickets.findOne({ where: { id: blockerId, deletedAt: IsNull() } }),
    ]);
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} not found`);
    if (!blocker) throw new NotFoundException(`Blocker ticket ${blockerId} not found`);
    if (ticket.projectId !== blocker.projectId) {
      throw new BadRequestException('Dependencies must be within the same project');
    }
    const existing = await this.deps.findOne({ where: { ticketId, blockerId } });
    if (existing) {
      throw new ConflictException('Dependency already exists');
    }
    await this.deps.insert({ ticketId, blockerId });
    await this.audit.record({
      action: AuditAction.DEPENDENCY_ADD,
      entityType: EntityType.TICKET,
      entityId: ticketId,
      performedBy: actorUserId,
      actor: ActorType.USER,
      metadata: { blockerId },
    });
  }

  async list(ticketId: number): Promise<{ id: number; title: string; status: TicketStatus }[]> {
    const ticket = await this.tickets.findOne({
      where: { id: ticketId, deletedAt: IsNull() },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} not found`);
    const rows = await this.deps.find({ where: { ticketId } });
    if (rows.length === 0) return [];
    const blockers = await this.tickets.find({
      where: { id: In(rows.map((r) => r.blockerId)) },
    });
    return blockers.map((b) => ({ id: b.id, title: b.title, status: b.status }));
  }

  async remove(
    ticketId: number,
    blockerId: number,
    actorUserId: number | null = null,
  ): Promise<void> {
    const ticket = await this.tickets.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} not found`);
    const dep = await this.deps.findOne({ where: { ticketId, blockerId } });
    if (!dep) throw new NotFoundException(`Dependency not found`);
    await this.deps.delete({ id: dep.id });
    await this.audit.record({
      action: AuditAction.DEPENDENCY_REMOVE,
      entityType: EntityType.TICKET,
      entityId: ticketId,
      performedBy: actorUserId,
      actor: ActorType.USER,
      metadata: { blockerId },
    });
  }

  /**
   * Called by TicketsService.update when status is being moved to DONE.
   * Fails fast if any blocker is still non-DONE; the unresolved blocker IDs
   * are returned in the error body so the client can react.
   */
  async assertBlockersResolvedForDone(ticketId: number): Promise<void> {
    const deps = await this.deps.find({ where: { ticketId } });
    if (deps.length === 0) return;
    const blockers = await this.tickets.find({
      where: { id: In(deps.map((d) => d.blockerId)) },
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

  /** Cascade hook fired by ticket soft-delete. */
  async cascadeHardDeleteDependencies(ticketIds: number[]): Promise<void> {
    if (ticketIds.length === 0) return;
    await this.deps
      .createQueryBuilder()
      .delete()
      .where('"ticketId" IN (:...ids) OR "blockerId" IN (:...ids)', { ids: ticketIds })
      .execute();
  }
}
