import {
  Controller,
  DefaultValuePipe,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { CommentsService, PaginatedMentions } from '../comments.service';
import { UsersService } from '../../users/users.service';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';

@Controller('users/:userId/mentions')
export class MentionsController {
  constructor(
    private readonly comments: CommentsService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async list(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<PaginatedMentions> {
    // 403 before 404: a non-admin asking for another user's feed gets the
    // same response whether the target exists or not — avoids leaking
    // user-existence to unauthorised callers.
    if (actor.role !== UserRole.ADMIN && actor.id !== userId) {
      throw new ForbiddenException("Cannot read another user's mention feed");
    }
    if (!(await this.users.existsAndActive(userId))) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    return this.comments.getMentionsForUser(userId, page, pageSize);
  }
}
