import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  ValidateIf,
} from 'class-validator';
import { TicketStatus } from '../../common/enums/ticket-status.enum';
import { TicketPriority } from '../../common/enums/ticket-priority.enum';
import { TicketType } from '../../common/enums/ticket-type.enum';

export class UpdateTicketDto {
  @IsOptional()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsNotEmpty()
  description?: string;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsEnum(TicketType)
  type?: TicketType;

  // The "unassign" path sends an explicit `null`. `@IsOptional` swallows
  // `undefined` (field absent); `@ValidateIf` skips `@IsInt` when the body
  // carries `null` so class-validator doesn't reject it with a 400. The
  // service then sees `dto.assigneeId === null` and clears the assignment.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  assigneeId?: number | null;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
