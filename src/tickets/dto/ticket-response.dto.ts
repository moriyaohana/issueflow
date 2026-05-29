import { Ticket } from '../entities/ticket.entity';
import { TicketStatus } from '../../common/enums/ticket-status.enum';
import { TicketPriority } from '../../common/enums/ticket-priority.enum';
import { TicketType } from '../../common/enums/ticket-type.enum';

/**
 * Wire shape for `GET /tickets`, `GET /tickets/:id`, and `POST /tickets`
 * responses. Matches the README documented shape exactly so internal columns
 * (`version`, `deletedByCascade`, `deletedAt`, `createdAt`, `updatedAt`) can
 * never leak. `version` is conveyed out-of-band via the `ETag` header.
 */
export class TicketResponseDto {
  id: number;
  projectId: number;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  type: TicketType;
  assigneeId: number | null;
  dueDate: Date | null;
  isOverdue: boolean;

  static fromEntity(ticket: Ticket): TicketResponseDto {
    const dto = new TicketResponseDto();
    dto.id = ticket.id;
    dto.projectId = ticket.projectId;
    dto.title = ticket.title;
    dto.description = ticket.description;
    dto.status = ticket.status;
    dto.priority = ticket.priority;
    dto.type = ticket.type;
    dto.assigneeId = ticket.assigneeId;
    dto.dueDate = ticket.dueDate;
    dto.isOverdue = ticket.isOverdue;
    return dto;
  }
}
