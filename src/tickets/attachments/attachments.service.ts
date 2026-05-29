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
    actorUserId: number;
  }): Promise<AttachmentMetadata> {
    await this.tickets.assertActive(args.ticketId);
    const saved = await this.attachments.save(
      this.attachments.create({
        ticketId: args.ticketId,
        filename: args.file.originalname,
        contentType: args.file.mimetype,
        sizeBytes: args.file.size,
        data: args.file.buffer,
        uploadedBy: args.actorUserId,
      }),
    );
    await this.audit.record({
      action: AuditAction.CREATE,
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
    await this.attachments.softDelete({ id: attachmentId });
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: EntityType.ATTACHMENT,
      entityId: attachmentId,
      ...actorOf(actorUserId),
      metadata: { ticketId },
    });
  }

  async cascadeSoftDeleteAttachments(
    ticketIds: number[],
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
      .set({ deletedAt: new Date(), deletedByCascade: true })
      .where('ticketId IN (:...ticketIds)', { ticketIds })
      .andWhere('deletedAt IS NULL')
      .execute();
    for (const r of rows) {
      await this.audit.record({
        action: AuditAction.DELETE,
        entityType: EntityType.ATTACHMENT,
        entityId: r.id,
        ...actorOf(actorUserId),
        metadata: { cascade: 'soft', ticketId: r.ticketId, ticketIds },
      });
    }
  }

  async cascadeRestoreAttachments(
    ticketIds: number[],
    actorUserId: number | null = null,
  ): Promise<void> {
    if (ticketIds.length === 0) return;
    const rows = await this.attachments.find({
      where: { ticketId: In(ticketIds), deletedByCascade: true },
      select: ['id', 'ticketId'],
      withDeleted: true,
    });
    if (rows.length === 0) return;
    await this.attachments
      .createQueryBuilder()
      .update(Attachment)
      .set({ deletedAt: null, deletedByCascade: false })
      .where('ticketId IN (:...ticketIds)', { ticketIds })
      .andWhere('deletedByCascade = TRUE')
      .execute();
    for (const r of rows) {
      await this.audit.record({
        action: AuditAction.RESTORE,
        entityType: EntityType.ATTACHMENT,
        entityId: r.id,
        ...actorOf(actorUserId),
        metadata: { cascade: 'soft', ticketId: r.ticketId, ticketIds },
      });
    }
  }
}
