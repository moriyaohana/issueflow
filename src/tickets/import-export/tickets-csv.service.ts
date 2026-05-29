import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TicketsService } from '../tickets.service';
import { ProjectsService } from '../../projects/projects.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { actorOf } from '../../audit-log/audit-log.helpers';
import { AuditAction } from '../../common/enums/audit-action.enum';
import { EntityType } from '../../common/enums/entity-type.enum';
import { MAX_IMPORT_ROWS } from '../../common/constants/import';
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
  private readonly logger = new Logger(TicketsCsvService.name);

  constructor(
    private readonly tickets: TicketsService,
    private readonly projects: ProjectsService,
    private readonly audit: AuditLogService,
  ) {}

  async export(
    projectId: number,
    actorUserId: number | null = null,
  ): Promise<string> {
    await this.projects.assertActive(projectId);
    const rows = await this.tickets.findAllForProject(projectId);
    const csv = stringify(rows.map(rowFromTicket), {
      header: true,
      columns: [...COLUMNS],
      quoted: true,
    });
    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: EntityType.PROJECT,
      entityId: projectId,
      ...actorOf(actorUserId),
      metadata: { event: 'export', ticketCount: rows.length },
    });
    return csv;
  }

  async import(
    projectId: number,
    file: { buffer: Buffer; originalname: string },
    actorUserId: number | null = null,
  ): Promise<ImportResult> {
    await this.projects.assertActive(projectId);
    const records: Record<string, string>[] = parse(file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
    if (records.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `Too many rows — limit is ${MAX_IMPORT_ROWS}`,
      );
    }
    const errors: ImportError[] = [];
    let created = 0;
    for (let i = 0; i < records.length; i++) {
      const dto = ticketFromRow(records[i], projectId);
      const violations = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      // i+2: file line 1 is the header, so parser row 0 lives on file line 2.
      const fileLine = i + 2;
      if (violations.length > 0) {
        errors.push({
          row: fileLine,
          error: violations
            .map((v) => Object.values(v.constraints || {}).join(', '))
            .join('; '),
        });
        continue;
      }
      try {
        await this.tickets.create(dto, actorUserId);
        created++;
      } catch (err) {
        errors.push({ row: fileLine, error: this.toRowErrorMessage(err) });
      }
    }
    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: EntityType.PROJECT,
      entityId: projectId,
      ...actorOf(actorUserId),
      metadata: { event: 'import', created, failed: errors.length },
    });
    return { created, failed: errors.length, errors };
  }

  // HttpException messages are user-safe; everything else is logged and
  // replaced with a generic string to avoid leaking internal text.
  private toRowErrorMessage(err: unknown): string {
    if (err instanceof HttpException) {
      const response = err.getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object') {
        const message = (response as { message?: unknown }).message;
        if (typeof message === 'string') return message;
        if (Array.isArray(message)) return message.join('; ');
      }
      return err.message;
    }
    this.logger.error(
      `Unexpected CSV import row error: ${(err as Error)?.message ?? err}`,
      (err as Error)?.stack,
    );
    return 'Internal error';
  }
}
