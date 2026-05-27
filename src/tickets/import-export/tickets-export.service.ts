import { Injectable, NotFoundException } from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import { TicketsService } from '../tickets.service';
import { ProjectsService } from '../../projects/projects.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction } from '../../common/enums/audit-action.enum';
import { EntityType } from '../../common/enums/entity-type.enum';
import { ActorType } from '../../common/enums/actor-type.enum';

const EXPORT_COLUMNS = [
  'id',
  'title',
  'description',
  'status',
  'priority',
  'type',
  'assigneeId',
] as const;

@Injectable()
export class TicketsExportService {
  constructor(
    private readonly tickets: TicketsService,
    private readonly projects: ProjectsService,
    private readonly audit: AuditLogService,
  ) {}

  async export(projectId: number, actorUserId: number | null = null): Promise<string> {
    const active = await this.projects.existsAndActive(projectId);
    if (!active) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    const rows = await this.tickets.findAllForProject(projectId);
    const csv = stringify(
      rows.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        type: t.type,
        assigneeId: t.assigneeId ?? '',
      })),
      { header: true, columns: [...EXPORT_COLUMNS], quoted: true },
    );
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
}
