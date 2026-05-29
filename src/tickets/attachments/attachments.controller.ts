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
import { AttachmentResponseDto } from './dto/attachment-response.dto';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';
import { MAX_UPLOAD_BYTES } from '../../common/constants/upload';
import { ALLOWED_ATTACHMENT_MIME_TYPE_REGEX } from '../../common/validators/attachment-mime.validator';

@Controller('tickets/:ticketId/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async upload(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @UploadedFile(
      // FileTypeValidator inspects the file signature (no
      // skipMagicNumbersValidation) so a renamed exe can't pass as image/png.
      new ParseFilePipe({
        fileIsRequired: true,
        validators: [
          new FileTypeValidator({
            fileType: ALLOWED_ATTACHMENT_MIME_TYPE_REGEX,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<AttachmentResponseDto> {
    const saved = await this.attachments.upload({
      ticketId,
      file,
      actorUserId: actor.id,
    });
    const dto = new AttachmentResponseDto();
    dto.id = saved.id;
    dto.ticketId = saved.ticketId;
    dto.filename = saved.filename;
    dto.contentType = saved.contentType;
    return dto;
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<void> {
    await this.attachments.delete(ticketId, attachmentId, actor.id);
  }
}
