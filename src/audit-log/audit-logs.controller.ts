import { Controller, Get, Query } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { AuditAction } from '../common/enums/audit-action.enum';
import { EntityType } from '../common/enums/entity-type.enum';
import { ActorType } from '../common/enums/actor-type.enum';
import { AuditLog } from './entities/audit-log.entity';

@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  list(
    @Query('entityType') entityType?: EntityType,
    @Query('entityId') entityId?: string,
    @Query('action') action?: AuditAction,
    @Query('actor') actor?: ActorType,
  ): Promise<AuditLog[]> {
    return this.audit.find({
      entityType,
      entityId: entityId !== undefined ? parseInt(entityId, 10) : undefined,
      action,
      actor,
    });
  }
}
