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
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { CommentResponseDto } from './dto/comment-response.dto';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { IfMatch } from '../common/decorators/if-match.decorator';

@Controller('tickets/:ticketId/comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  async list(
    @Param('ticketId', ParseIntPipe) ticketId: number,
  ): Promise<CommentResponseDto[]> {
    const rows = await this.comments.findForTicket(ticketId);
    return rows.map((r) => CommentResponseDto.fromEntity(r, r.mentionedUsers));
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async create(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser() actor: CurrentUserPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CommentResponseDto> {
    const created = await this.comments.create(ticketId, dto, actor.id);
    // `version` is forwarded out-of-band via ETag; the wire DTO drops it.
    res.setHeader('ETag', `W/"${created.version}"`);
    return CommentResponseDto.fromEntity(created, created.mentionedUsers);
  }

  @Patch(':commentId')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() actor: CurrentUserPayload,
    @IfMatch() expectedVersion: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CommentResponseDto> {
    const updated = await this.comments.update(
      ticketId,
      commentId,
      dto,
      actor,
      expectedVersion,
    );
    res.setHeader('ETag', `W/"${updated.version}"`);
    return CommentResponseDto.fromEntity(updated, updated.mentionedUsers);
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
