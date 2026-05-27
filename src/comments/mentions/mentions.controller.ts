import { Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { CommentsService, PaginatedMentions } from '../comments.service';

@Controller('users/:userId/mentions')
export class MentionsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  list(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ): Promise<PaginatedMentions> {
    return this.comments.getMentionsForUser(userId, page, pageSize);
  }
}
