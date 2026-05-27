import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from './entities/comment.entity';
import { Mention } from './entities/mention.entity';
import { User } from '../users/entities/user.entity';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { MentionsController } from './mentions/mentions.controller';
import { MentionParser } from './mentions/mention-parser';
import { TicketsModule } from '../tickets/tickets.module';
import { UsersModule } from '../users/users.module';
import { TicketsService } from '../tickets/tickets.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Comment, Mention, User]),
    TicketsModule,
    UsersModule,
  ],
  providers: [CommentsService, MentionParser],
  controllers: [CommentsController, MentionsController],
  exports: [CommentsService],
})
export class CommentsModule implements OnModuleInit {
  constructor(
    private readonly tickets: TicketsService,
    private readonly comments: CommentsService,
  ) {}

  // Register the comment cascade target so TicketsService can hard-delete
  // comments when a ticket (or its parent project) is soft-deleted.
  onModuleInit(): void {
    this.tickets.registerCascadeTarget({
      cascadeHardDeleteComments: (ids, actor) =>
        this.comments.cascadeHardDeleteComments(ids, actor),
    });
  }
}
