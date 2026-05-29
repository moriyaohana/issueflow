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
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { IfMatch } from '../common/decorators/if-match.decorator';

@Controller('tickets/:ticketId/comments')
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
    return this.comments.create(ticketId, dto, actor.id);
  }

  @Patch(':commentId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() actor: CurrentUserPayload,
    @IfMatch() expectedVersion: number,
  ) {
    return this.comments.update(
      ticketId,
      commentId,
      dto,
      actor,
      expectedVersion,
    );
  }

  @Delete(':commentId')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() actor: CurrentUserPayload,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    await this.comments.delete(ticketId, commentId, actor, expectedVersion);
  }
}
