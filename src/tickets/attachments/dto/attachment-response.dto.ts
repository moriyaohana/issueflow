import { Attachment } from '../entities/attachment.entity';

/**
 * Wire shape for attachment responses. Matches the README documented set
 * exactly — the binary `data` buffer, the `uploadedBy` actor id, and the
 * `deletedByCascade` cascade flag are intentionally absent so a future GET
 * path can't accidentally leak them.
 */
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
