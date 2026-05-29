import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Attachment } from './entities/attachment.entity';
import { TicketsService } from '../tickets.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction } from '../../common/enums/audit-action.enum';
import { EntityType } from '../../common/enums/entity-type.enum';
import { ActorType } from '../../common/enums/actor-type.enum';

export interface AttachmentMetadata {
  id: number;
  ticketId: number;
  filename: string;
  contentType: string;
}

@Injectable()
export class AttachmentsService {
  constructor(
    @InjectRepository(Attachment)
    private readonly attachments: Repository<Attachment>,
    private readonly tickets: TicketsService,
    private readonly audit: AuditLogService,
  ) {}

  async upload(args: {
    ticketId: number;
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    };
    userId: number;
    actorUserId: number | null;
  }): Promise<AttachmentMetadata> {
    if (!(await this.tickets.existsAndActive(args.ticketId))) {
      throw new NotFoundException(`Ticket ${args.ticketId} not found`);
    }
    const saved = await this.attachments.save(
      this.attachments.create({
        ticketId: args.ticketId,
        filename: args.file.originalname,
        contentType: args.file.mimetype,
        sizeBytes: args.file.size,
        data: args.file.buffer,
        uploadedBy: args.userId,
      }),
    );
    await this.audit.record({
      action: AuditAction.ATTACHMENT_UPLOAD,
      entityType: EntityType.ATTACHMENT,
      entityId: saved.id,
      performedBy: args.actorUserId,
      actor: ActorType.USER,
      metadata: {
        ticketId: args.ticketId,
        filename: saved.filename,
        sizeBytes: saved.sizeBytes,
      },
    });
    return {
      id: saved.id,
      ticketId: saved.ticketId,
      filename: saved.filename,
      contentType: saved.contentType,
    };
  }

  async delete(
    ticketId: number,
    attachmentId: number,
    actorUserId: number | null = null,
  ): Promise<void> {
    const attachment = await this.attachments.findOne({
      where: { id: attachmentId },
    });
    if (!attachment || attachment.ticketId !== ticketId) {
      throw new NotFoundException(`Attachment ${attachmentId} not found`);
    }
    await this.attachments.delete({ id: attachmentId });
    await this.audit.record({
      action: AuditAction.ATTACHMENT_DELETE,
      entityType: EntityType.ATTACHMENT,
      entityId: attachmentId,
      performedBy: actorUserId,
      actor: ActorType.USER,
      metadata: { ticketId },
    });
  }

  /** Cascade hook fired by ticket soft-delete. */
  async cascadeHardDeleteAttachments(
    ticketIds: number[],
    actorUserId: number | null = null,
  ): Promise<void> {
    if (ticketIds.length === 0) return;
    const rows = await this.attachments.find({
      where: { ticketId: In(ticketIds) },
      select: ['id', 'ticketId'],
    });
    if (rows.length === 0) return;
    await this.attachments.delete({ id: In(rows.map((r) => r.id)) });
    for (const r of rows) {
      await this.audit.record({
        action: AuditAction.ATTACHMENT_DELETE,
        entityType: EntityType.ATTACHMENT,
        entityId: r.id,
        performedBy: actorUserId,
        actor: ActorType.USER,
        metadata: { cascade: true, ticketId: r.ticketId },
      });
    }
  }
}
