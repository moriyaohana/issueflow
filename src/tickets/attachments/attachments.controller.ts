import {
  Controller,
  Delete,
  FileTypeValidator,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipe,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AttachmentsService } from './attachments.service';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';
import { ALLOWED_ATTACHMENT_MIME_TYPES } from '../../common/enums/attachment-mime-type.enum';

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
// Allowlist values are static enum strings (e.g. "image/png"); the only regex
// metachar in scope is "/", so a plain alternation is safe — no escaping needed.
const ALLOWED_ATTACHMENT_MIME_TYPE_REGEX = new RegExp(
  `^(?:${ALLOWED_ATTACHMENT_MIME_TYPES.join('|')})$`,
);

@Controller('tickets/:ticketId/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_ATTACHMENT_SIZE },
    }),
  )
  upload(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: true,
        validators: [
          new FileTypeValidator({
            fileType: ALLOWED_ATTACHMENT_MIME_TYPE_REGEX,
            skipMagicNumbersValidation: true,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
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
