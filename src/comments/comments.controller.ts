import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { IfMatch } from '../common/decorators/if-match.decorator';
import { ETagInterceptor } from '../common/interceptors/etag.interceptor';

@Controller('tickets/:ticketId/comments')
@UseInterceptors(ETagInterceptor)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  list(@Param('ticketId', ParseIntPipe) ticketId: number) {
    return this.comments.findForTicket(ticketId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.comments.create(ticketId, dto, actor?.id ?? null);
  }

  @Patch(':commentId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('ticketId', ParseIntPipe) _ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() actor: CurrentUserPayload,
    @IfMatch() expectedVersion: number,
  ) {
    return this.comments.update(
      commentId,
      dto,
      actor?.id ?? null,
      expectedVersion,
    );
  }

  @Delete(':commentId')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('ticketId', ParseIntPipe) _ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() actor: CurrentUserPayload,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    await this.comments.delete(commentId, actor?.id ?? null, expectedVersion);
  }
}
