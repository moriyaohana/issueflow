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
    // Export is logged as a CREATE on the project (a new CSV artifact). The
    // README vocabulary doesn't include a dedicated EXPORT verb; the
    // `event: 'export'` metadata tag preserves the original semantics for
    // forensics.
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
    const active = await this.projects.existsAndActive(projectId);
    if (!active) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    const records: Record<string, string>[] = parse(file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
    if (records.length > MAX_IMPORT_ROWS) {
      // Reject oversized imports up-front: without this guard a 10 MB CSV of
      // narrow rows could still spawn thousands of per-row transactions and
      // exhaust the request timeout. Caller is expected to chunk client-side.
      throw new BadRequestException(
        `Too many rows — limit is ${MAX_IMPORT_ROWS}`,
      );
    }
    const errors: ImportError[] = [];
    let created = 0;
    for (let i = 0; i < records.length; i++) {
      const dto = ticketFromRow(records[i], projectId);
      // `forbidNonWhitelisted` makes CSVs with stowaway columns (e.g. a
      // typo'd header or a malicious `role`) surface as row errors instead
      // of being silently stripped. Same posture as the global ValidationPipe.
      const violations = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      // CSV row index → file line number: row 0 of the parser is the row
      // after the header (i.e. line 2 of the file). Report the human-visible
      // line so the error message matches what the operator sees in the CSV.
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
    // Import is logged as CREATE on the project; the per-ticket CREATE rows
    // are emitted by TicketsService.create. The `event: 'import'` metadata tag
    // distinguishes this summary row from a plain project creation.
    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: EntityType.PROJECT,
      entityId: projectId,
      ...actorOf(actorUserId),
      metadata: { event: 'import', created, failed: errors.length },
    });
    return { created, failed: errors.length, errors };
  }

  /**
   * Project a row-level error into the public `errors[]` payload. We surface
   * the user-facing message from validated `HttpException`s (which already
   * carries an audited, internationalisable string) and replace every other
   * thrown shape with a generic `'Internal error'` to avoid leaking raw
   * exception text (stack traces, query strings, PII) over the wire. The
   * original error is logged for ops triage.
   */
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
