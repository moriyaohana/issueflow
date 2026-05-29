import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional } from 'class-validator';
import { AuditAction } from '../../common/enums/audit-action.enum';
import { ActorType } from '../../common/enums/actor-type.enum';
import { EntityType } from '../../common/enums/entity-type.enum';

/**
 * Query filters for `GET /audit-logs`. Every field is optional; the controller
 * forwards the parsed DTO directly to `AuditLogService.find`. Query-string
 * values arrive as strings, so `entityId` uses `@Type(() => Number)` to coerce
 * before `@IsInt` rejects non-numeric input — previously the controller called
 * `parseInt(entityId, 10)` and silently passed `NaN` through to TypeORM.
 */
export class AuditLogQueryDto {
  @IsOptional()
  @IsEnum(EntityType)
  entityType?: EntityType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  entityId?: number;

  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsEnum(ActorType)
  actor?: ActorType;
}
