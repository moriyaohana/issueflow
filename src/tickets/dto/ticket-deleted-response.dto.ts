import { Ticket } from '../entities/ticket.entity';
import { TicketStatus } from '../../common/enums/ticket-status.enum';
import { TicketPriority } from '../../common/enums/ticket-priority.enum';
import { TicketType } from '../../common/enums/ticket-type.enum';

export class TicketDeletedResponseDto {
  id: number;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  type: TicketType;
  projectId: number;

  static fromEntity(ticket: Ticket): TicketDeletedResponseDto {
    const dto = new TicketDeletedResponseDto();
    dto.id = ticket.id;
    dto.title = ticket.title;
    dto.status = ticket.status;
    dto.priority = ticket.priority;
    dto.type = ticket.type;
    dto.projectId = ticket.projectId;
    return dto;
  }
}
