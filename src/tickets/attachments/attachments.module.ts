import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attachment } from './entities/attachment.entity';
import { AttachmentsService } from './attachments.service';
import { AttachmentsController } from './attachments.controller';
import { TicketsModule } from '../tickets.module';
import { TicketsService } from '../tickets.service';

@Module({
  imports: [TypeOrmModule.forFeature([Attachment]), TicketsModule],
  providers: [AttachmentsService],
  controllers: [AttachmentsController],
  exports: [AttachmentsService],
})
export class AttachmentsModule implements OnModuleInit {
  constructor(
    private readonly tickets: TicketsService,
    private readonly attachments: AttachmentsService,
  ) {}

  onModuleInit(): void {
    this.tickets.registerCascadeTarget({
      cascadeSoftDeleteAttachments: (ids, actor) =>
        this.attachments.cascadeSoftDeleteAttachments(ids, actor),
      cascadeRestoreAttachments: (ids, actor) =>
        this.attachments.cascadeRestoreAttachments(ids, actor),
    });
  }
}
