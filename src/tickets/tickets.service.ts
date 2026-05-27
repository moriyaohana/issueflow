import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Ticket } from './entities/ticket.entity';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketStatus, TICKET_STATUS_ORDER } from '../common/enums/ticket-status.enum';
import { ProjectsService } from '../projects/projects.service';
import { UsersService } from '../users/users.service';

export interface TicketCascadeTarget {
  cascadeHardDeleteComments(ticketIds: number[]): Promise<void>;
  cascadeHardDeleteDependencies(ticketIds: number[]): Promise<void>;
  cascadeHardDeleteAttachments(ticketIds: number[]): Promise<void>;
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

  async create(dto: CreateTicketDto): Promise<Ticket> {
    const projectActive = await this.projects.existsAndActive(dto.projectId);
    if (!projectActive) {
      throw new NotFoundException(`Project ${dto.projectId} not found`);
    }
    if (dto.assigneeId != null) {
      const ok = await this.users.existsAndActive(dto.assigneeId);
      if (!ok) {
        throw new BadRequestException(`Assignee ${dto.assigneeId} is missing or deleted`);
      }
    }

    let assigneeId = dto.assigneeId ?? null;
    if (assigneeId == null && this.autoAssign) {
      assigneeId = await this.autoAssign.pickAssignee(dto.projectId);
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
    return this.tickets.save(ticket);
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
    const ticket = await this.tickets.findOne({ where: { id, deletedAt: IsNull() } });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);
    return ticket;
  }

  /**
   * Update flow enforces, in order:
   *   1. ticket exists and is not soft-deleted (404)
   *   2. DONE tickets are immutable (403)
   *   3. optimistic-locking version match (409)
   *   4. forward-only status progression (400)
   *   5. blockers must be DONE before status → DONE (filled in Agent 8)
   *   6. user-supplied priority pauses auto-escalation and clears isOverdue
   *   7. version increments on every successful save
   */
  async update(id: number, dto: UpdateTicketDto): Promise<Ticket> {
    const ticket = await this.tickets.findOne({ where: { id }, withDeleted: true });
    if (!ticket || ticket.deletedAt) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }
    if (ticket.status === TicketStatus.DONE) {
      throw new ForbiddenException('Ticket is DONE and cannot be modified');
    }
    if (dto.version !== ticket.version) {
      throw new ConflictException({
        message: 'Version mismatch',
        currentVersion: ticket.version,
      });
    }
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
          throw new BadRequestException(`Assignee ${dto.assigneeId} is missing or deleted`);
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
    return this.tickets.save(ticket);
  }

  async softDelete(id: number): Promise<void> {
    const ticket = await this.findOne(id);
    await this.runCascadeDeletes([ticket.id]);
    await this.tickets.softRemove(ticket);
  }

  async restore(id: number): Promise<Ticket> {
    const ticket = await this.tickets.findOne({ where: { id }, withDeleted: true });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);
    if (!ticket.deletedAt) return ticket;
    await this.tickets.restore(id);
    if (ticket.deletedByCascade) {
      ticket.deletedByCascade = false;
      await this.tickets.update(id, { deletedByCascade: false });
    }
    return this.tickets.findOne({ where: { id } }) as Promise<Ticket>;
  }

  /** Cascade hook fired by ProjectsService.softDelete. */
  async cascadeSoftDeleteForProject(projectId: number): Promise<void> {
    const tickets = await this.tickets.find({
      where: { projectId, deletedAt: IsNull() },
    });
    if (tickets.length === 0) return;
    const ids = tickets.map((t) => t.id);
    await this.tickets.update({ id: In(ids) }, { deletedByCascade: true });
    await this.runCascadeDeletes(ids);
    await this.tickets.softRemove(tickets);
  }

  /** Cascade hook fired by ProjectsService.restore. */
  async cascadeRestoreForProject(projectId: number): Promise<void> {
    const candidates = await this.tickets.find({
      where: { projectId, deletedByCascade: true, deletedAt: Not(IsNull()) },
      withDeleted: true,
    });
    if (candidates.length === 0) return;
    const ids = candidates.map((t) => t.id);
    await this.tickets.restore({ id: In(ids) });
    await this.tickets.update({ id: In(ids) }, { deletedByCascade: false });
  }

  private async runCascadeDeletes(ticketIds: number[]): Promise<void> {
    if (ticketIds.length === 0) return;
    if (this.cascade.cascadeHardDeleteComments) {
      await this.cascade.cascadeHardDeleteComments(ticketIds);
    }
    if (this.cascade.cascadeHardDeleteDependencies) {
      await this.cascade.cascadeHardDeleteDependencies(ticketIds);
    }
    if (this.cascade.cascadeHardDeleteAttachments) {
      await this.cascade.cascadeHardDeleteAttachments(ticketIds);
    }
  }

  async existsAndActive(id: number): Promise<boolean> {
    const count = await this.tickets.count({ where: { id, deletedAt: IsNull() } });
    return count > 0;
  }
}
