import {
  BadRequestException,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AttachmentsService } from './attachments.service';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ALLOWED_ATTACHMENT_MIME_TYPES } from '../../common/enums/attachment-mime-type.enum';

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

@Controller('tickets/:ticketId/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_ATTACHMENT_SIZE },
      fileFilter: (_req, file, cb) => {
        const ok = (ALLOWED_ATTACHMENT_MIME_TYPES as string[]).includes(file.mimetype);
        cb(ok ? null : new BadRequestException('Unsupported file type'), ok);
      },
    }),
  )
  upload(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.attachments.upload({
      ticketId,
      file,
      userId: actor.id,
      actorUserId: actor?.id ?? null,
    });
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<void> {
    await this.attachments.delete(ticketId, attachmentId, actor?.id ?? null);
  }
}
