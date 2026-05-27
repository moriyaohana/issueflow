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
  ) {
    return this.comments.create(ticketId, dto);
  }

  @Patch(':commentId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('ticketId', ParseIntPipe) _ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.comments.update(commentId, dto);
  }

  @Delete(':commentId')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('ticketId', ParseIntPipe) _ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
  ): Promise<void> {
    await this.comments.delete(commentId);
  }
}
