import { Attachment } from '../entities/attachment.entity';

export class AttachmentResponseDto {
  id: number;
  ticketId: number;
  filename: string;
  contentType: string;

  static fromEntity(attachment: Attachment): AttachmentResponseDto {
    const dto = new AttachmentResponseDto();
    dto.id = attachment.id;
    dto.ticketId = attachment.ticketId;
    dto.filename = attachment.filename;
    dto.contentType = attachment.contentType;
    return dto;
  }
}
