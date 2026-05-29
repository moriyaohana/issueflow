import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Attachment } from './entities/attachment.entity';
import { TicketsService } from '../tickets.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { actorOf } from '../../audit-log/audit-log.helpers';
import { AuditAction } from '../../common/enums/audit-action.enum';
import { EntityType } from '../../common/enums/entity-type.enum';

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
      ...actorOf(args.actorUserId),
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
      where: { id: attachmentId, deletedAt: IsNull() },
    });
    if (!attachment || attachment.ticketId !== ticketId) {
      throw new NotFoundException(`Attachment ${attachmentId} not found`);
    }
    await this.attachments.delete({ id: attachmentId });
    await this.audit.record({
      action: AuditAction.ATTACHMENT_DELETE,
      entityType: EntityType.ATTACHMENT,
      entityId: attachmentId,
      ...actorOf(actorUserId),
      metadata: { ticketId },
    });
  }

  /**
   * Cascade hook fired by ticket soft-delete.
   * Soft-deletes live attachments owned by the given tickets so they can be
   * restored alongside the ticket. The child's `deletedAt` is stamped to the
   * parent ticket's `deletedAt` so the restore path can match them exactly.
   */
  async cascadeSoftDeleteAttachments(
    ticketIds: number[],
    parentDeletedAt: Date,
    actorUserId: number | null = null,
  ): Promise<void> {
    if (ticketIds.length === 0) return;
    const rows = await this.attachments.find({
      where: { ticketId: In(ticketIds), deletedAt: IsNull() },
      select: ['id', 'ticketId'],
    });
    if (rows.length === 0) return;
    await this.attachments
      .createQueryBuilder()
      .update(Attachment)
      .set({ deletedAt: parentDeletedAt })
      .where('ticketId IN (:...ticketIds)', { ticketIds })
      .andWhere('deletedAt IS NULL')
      .execute();
    for (const r of rows) {
      await this.audit.record({
        action: AuditAction.ATTACHMENT_DELETE,
        entityType: EntityType.ATTACHMENT,
        entityId: r.id,
        ...actorOf(actorUserId),
        metadata: { cascade: 'soft', ticketId: r.ticketId, ticketIds },
      });
    }
  }

  /**
   * Restore previously cascade-soft-deleted attachments. Only rows whose
   * `deletedAt` matches the parent ticket's `deletedAt` at delete time come
   * back — independently-deleted attachments with a different timestamp are
   * left alone.
   */
  async cascadeRestoreAttachments(
    ticketIds: number[],
    parentDeletedAt: Date,
    actorUserId: number | null = null,
  ): Promise<void> {
    if (ticketIds.length === 0) return;
    const rows = await this.attachments.find({
      where: { ticketId: In(ticketIds), deletedAt: parentDeletedAt },
      select: ['id', 'ticketId'],
      withDeleted: true,
    });
    if (rows.length === 0) return;
    await this.attachments
      .createQueryBuilder()
      .update(Attachment)
      .set({ deletedAt: null })
      .where('ticketId IN (:...ticketIds)', { ticketIds })
      .andWhere('deletedAt = :parentDeletedAt', { parentDeletedAt })
      .execute();
    for (const r of rows) {
      await this.audit.record({
        action: AuditAction.ATTACHMENT_RESTORE,
        entityType: EntityType.ATTACHMENT,
        entityId: r.id,
        ...actorOf(actorUserId),
        metadata: { cascade: 'soft', ticketId: r.ticketId, ticketIds },
      });
    }
  }
}
