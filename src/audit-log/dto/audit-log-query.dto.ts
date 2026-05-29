import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional } from 'class-validator';
import { AuditAction } from '../../common/enums/audit-action.enum';
import { ActorType } from '../../common/enums/actor-type.enum';
import { EntityType } from '../../common/enums/entity-type.enum';

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
