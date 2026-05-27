import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TicketsService } from '../tickets.service';
import { ProjectsService } from '../../projects/projects.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction } from '../../common/enums/audit-action.enum';
import { EntityType } from '../../common/enums/entity-type.enum';
import { ActorType } from '../../common/enums/actor-type.enum';
import { CreateTicketDto } from '../dto/create-ticket.dto';

export interface ImportError {
  row: number;
  error: string;
}

export interface ImportResult {
  created: number;
  failed: number;
  errors: ImportError[];
}

@Injectable()
export class TicketsImportService {
  constructor(
    private readonly tickets: TicketsService,
    private readonly projects: ProjectsService,
    private readonly audit: AuditLogService,
  ) {}

  async import(
    projectId: number,
    file: { buffer: Buffer; originalname: string } | undefined,
    actorUserId: number | null = null,
  ): Promise<ImportResult> {
    if (!file) {
      throw new BadRequestException('CSV file is required');
    }
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
      const raw = records[i];
      const dto = plainToInstance(CreateTicketDto, {
        title: raw.title,
        description: raw.description,
        status: raw.status,
        priority: raw.priority,
        type: raw.type,
        projectId,
        assigneeId: raw.assigneeId ? parseInt(raw.assigneeId, 10) : undefined,
      });
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
