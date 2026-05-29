import { Injectable, NotFoundException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TicketsService } from '../tickets.service';
import { ProjectsService } from '../../projects/projects.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction } from '../../common/enums/audit-action.enum';
import { EntityType } from '../../common/enums/entity-type.enum';
import { ActorType } from '../../common/enums/actor-type.enum';
import { CreateTicketDto } from '../dto/create-ticket.dto';
import { Ticket } from '../entities/ticket.entity';

export interface ImportError {
  row: number;
  error: string;
}

export interface ImportResult {
  created: number;
  failed: number;
  errors: ImportError[];
}

const COLUMNS = [
  'id',
  'title',
  'description',
  'status',
  'priority',
  'type',
  'assigneeId',
] as const;

function rowFromTicket(t: Ticket): Record<string, unknown> {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    type: t.type,
    assigneeId: t.assigneeId ?? '',
  };
}

function ticketFromRow(
  raw: Record<string, string>,
  projectId: number,
): CreateTicketDto {
  return plainToInstance(CreateTicketDto, {
    title: raw.title,
    description: raw.description,
    status: raw.status,
    priority: raw.priority,
    type: raw.type,
    projectId,
    assigneeId: raw.assigneeId ? parseInt(raw.assigneeId, 10) : undefined,
  });
}

@Injectable()
export class TicketsCsvService {
  constructor(
    private readonly tickets: TicketsService,
    private readonly projects: ProjectsService,
    private readonly audit: AuditLogService,
  ) {}

  async export(
    projectId: number,
    actorUserId: number | null = null,
  ): Promise<string> {
    const active = await this.projects.existsAndActive(projectId);
    if (!active) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    const rows = await this.tickets.findAllForProject(projectId);
    const csv = stringify(rows.map(rowFromTicket), {
      header: true,
      columns: [...COLUMNS],
      quoted: true,
    });
    await this.audit.record({
      action: AuditAction.TICKET_EXPORT,
      entityType: EntityType.PROJECT,
      entityId: projectId,
      performedBy: actorUserId,
      actor: ActorType.USER,
      metadata: { ticketCount: rows.length },
    });
    return csv;
  }

  async import(
    projectId: number,
    file: { buffer: Buffer; originalname: string },
    actorUserId: number | null = null,
  ): Promise<ImportResult> {
    const active = await this.projects.existsAndActive(projectId);
    if (!active) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    const records: Record<string, string>[] = parse(file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
    const errors: ImportError[] = [];
    let created = 0;
    for (let i = 0; i < records.length; i++) {
      const dto = ticketFromRow(records[i], projectId);
      const violations = await validate(dto, { whitelist: true });
      if (violations.length > 0) {
        errors.push({
          row: i + 1,
          error: violations
            .map((v) => Object.values(v.constraints || {}).join(', '))
            .join('; '),
        });
        continue;
      }
      try {
        await this.tickets.create(dto, actorUserId);
        created++;
      } catch (err: any) {
        errors.push({ row: i + 1, error: err?.message ?? 'Unknown error' });
      }
    }
    await this.audit.record({
      action: AuditAction.TICKET_IMPORT,
      entityType: EntityType.PROJECT,
      entityId: projectId,
      performedBy: actorUserId,
      actor: ActorType.USER,
      metadata: { created, failed: errors.length },
    });
    return { created, failed: errors.length, errors };
  }
}
