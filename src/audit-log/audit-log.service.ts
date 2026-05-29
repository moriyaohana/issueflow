import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditAction } from '../common/enums/audit-action.enum';
import { EntityType } from '../common/enums/entity-type.enum';
import { ActorType } from '../common/enums/actor-type.enum';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

export interface AuditRecordInput {
  action: AuditAction;
  entityType: EntityType;
  entityId: number;
  performedBy: number | null;
  actor: ActorType;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  /**
   * Append-only write. We never let an audit failure propagate to the caller
   * since the business action already succeeded — the audit log is a record
   * of truth, not a gate. Failures are logged for ops triage.
   */
  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.repo.insert({
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        performedBy: input.performedBy,
        actor: input.actor,
        metadata: input.metadata ?? null,
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  async find(filters: AuditLogQueryDto): Promise<AuditLog[]> {
    const where: FindOptionsWhere<AuditLog> = {};
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId !== undefined) where.entityId = filters.entityId;
    if (filters.action) where.action = filters.action;
    if (filters.actor) where.actor = filters.actor;
    return this.repo.find({ where, order: { timestamp: 'DESC' } });
  }
}
