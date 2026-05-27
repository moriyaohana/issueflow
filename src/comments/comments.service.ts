import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Comment } from './entities/comment.entity';
import { Mention } from './entities/mention.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { MentionParser } from './mentions/mention-parser';
import { TicketsService } from '../tickets/tickets.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../common/enums/audit-action.enum';
import { EntityType } from '../common/enums/entity-type.enum';
import { ActorType } from '../common/enums/actor-type.enum';

export interface CommentResponse {
  id: number;
  ticketId: number;
  authorId: number;
  content: string;
  mentionedUsers: { id: number; username: string; fullName: string }[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedMentions {
  data: CommentResponse[];
  total: number;
  page: number;
}

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
    @InjectRepository(Mention) private readonly mentions: Repository<Mention>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly mentionParser: MentionParser,
    private readonly tickets: TicketsService,
    private readonly users: UsersService,
    private readonly audit: AuditLogService,
  ) {}

  async create(
    ticketId: number,
    dto: CreateCommentDto,
    actorUserId: number | null = null,
  ): Promise<CommentResponse> {
    if (!(await this.tickets.existsAndActive(ticketId))) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }
    if (!(await this.users.existsAndActive(dto.authorId))) {
      throw new BadRequestException(`Author ${dto.authorId} is missing or deleted`);
    }
    const saved = await this.comments.save(
      this.comments.create({ ticketId, authorId: dto.authorId, content: dto.content }),
    );
    const mentioned = await this.mentionParser.resolve(dto.content);
    if (mentioned.length > 0) {
      await this.mentions.insert(
        mentioned.map((u) => ({ commentId: saved.id, userId: u.id })),
      );
    }
    await this.audit.record({
      action: AuditAction.COMMENT_CREATE,
      entityType: EntityType.COMMENT,
      entityId: saved.id,
      performedBy: actorUserId,
      actor: ActorType.USER,
      metadata: { ticketId, mentionedUserIds: mentioned.map((u) => u.id) },
    });
    return this.toResponse(saved, mentioned);
  }

  /**
   * Update with pessimistic write-lock on the comment row.
   *
   * The lock guarantees that two concurrent edits cannot both succeed. We
   * re-fetch under the lock, re-parse mentions, diff against existing rows,
   * delete removed mentions, insert new ones, then commit. A pg lock-wait
   * timeout / deadlock is mapped to 409 ConflictException so the caller
   * knows to retry.
   */
  async update(
    commentId: number,
    dto: UpdateCommentDto,
    actorUserId: number | null = null,
  ): Promise<CommentResponse> {
    try {
      const response = await this.dataSource.transaction(async (manager) => {
        const comment = await manager
          .getRepository(Comment)
          .createQueryBuilder('c')
          .setLock('pessimistic_write')
          .where('c.id = :id', { id: commentId })
          .getOne();
        if (!comment) throw new NotFoundException(`Comment ${commentId} not found`);

        comment.content = dto.content;
        await manager.getRepository(Comment).save(comment);

        const newMentions = await this.mentionParser.resolve(dto.content);
        const newUserIds = new Set(newMentions.map((u) => u.id));
        const existing = await manager
          .getRepository(Mention)
          .find({ where: { commentId } });
        const existingUserIds = new Set(existing.map((m) => m.userId));

        const toDelete = existing.filter((m) => !newUserIds.has(m.userId));
        const toAdd = [...newUserIds].filter((id) => !existingUserIds.has(id));

        if (toDelete.length > 0) {
          await manager.getRepository(Mention).delete({
            id: In(toDelete.map((m) => m.id)),
          });
        }
        if (toAdd.length > 0) {
          await manager.getRepository(Mention).insert(
            toAdd.map((userId) => ({ commentId, userId })),
          );
        }
        return this.toResponse(comment, newMentions);
      });
      await this.audit.record({
        action: AuditAction.COMMENT_UPDATE,
        entityType: EntityType.COMMENT,
        entityId: commentId,
        performedBy: actorUserId,
        actor: ActorType.USER,
      });
      return response;
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      if (err?.code === '55P03' || err?.code === '40P01') {
        throw new ConflictException('Comment is being edited; try again');
      }
      throw err;
    }
  }

  async delete(commentId: number, actorUserId: number | null = null): Promise<void> {
    const comment = await this.comments.findOne({ where: { id: commentId } });
    if (!comment) throw new NotFoundException(`Comment ${commentId} not found`);
    await this.comments.delete({ id: commentId });
    await this.audit.record({
      action: AuditAction.COMMENT_DELETE,
      entityType: EntityType.COMMENT,
      entityId: commentId,
      performedBy: actorUserId,
      actor: ActorType.USER,
    });
  }

  async findForTicket(ticketId: number): Promise<CommentResponse[]> {
    if (!(await this.tickets.existsAndActive(ticketId))) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }
    const rows = await this.comments.find({
      where: { ticketId },
      order: { createdAt: 'ASC' },
    });
    return Promise.all(rows.map(async (c) => this.toResponseWithLookup(c)));
  }

  async getMentionsForUser(
    userId: number,
    page = 1,
    pageSize = 20,
  ): Promise<PaginatedMentions> {
    const take = Math.max(1, pageSize);
    const skip = (Math.max(1, page) - 1) * take;
    const [mentionRows, total] = await this.mentions.findAndCount({
      where: { userId },
      take,
      skip,
    });
    if (mentionRows.length === 0) {
      return { data: [], total, page };
    }
    const commentIds = mentionRows.map((m) => m.commentId);
    const comments = await this.comments.find({
      where: { id: In(commentIds) },
      order: { createdAt: 'DESC' },
    });
    const data = await Promise.all(comments.map((c) => this.toResponseWithLookup(c)));
    return { data, total, page };
  }

  /** Cascade hook fired by TicketsService.softDelete (and project cascade). */
  async cascadeHardDeleteComments(
    ticketIds: number[],
    actorUserId: number | null = null,
  ): Promise<void> {
    if (ticketIds.length === 0) return;
    const ids = (
      await this.comments.find({ where: { ticketId: In(ticketIds) }, select: ['id'] })
    ).map((c) => c.id);
    if (ids.length > 0) {
      await this.mentions.delete({ commentId: In(ids) });
    }
    await this.comments.delete({ ticketId: In(ticketIds) });
    for (const commentId of ids) {
      await this.audit.record({
        action: AuditAction.COMMENT_DELETE,
        entityType: EntityType.COMMENT,
        entityId: commentId,
        performedBy: actorUserId,
        actor: ActorType.USER,
        metadata: { cascade: true, ticketIds },
      });
    }
  }

  private async toResponseWithLookup(comment: Comment): Promise<CommentResponse> {
    const rows = await this.mentions.find({ where: { commentId: comment.id } });
    const ids = rows.map((r) => r.userId);
    if (ids.length === 0) return this.toResponse(comment, []);
    const users = await this.userRepo.find({ where: { id: In(ids) } });
    return this.toResponse(
      comment,
      users.map((u) => ({ id: u.id, username: u.username, fullName: u.fullName })),
    );
  }

  private toResponse(
    comment: Comment,
    mentioned: { id: number; username: string; fullName: string }[],
  ): CommentResponse {
    return {
      id: comment.id,
      ticketId: comment.ticketId,
      authorId: comment.authorId,
      content: comment.content,
      mentionedUsers: mentioned.map((u) => ({
        id: u.id,
        username: u.username,
        fullName: u.fullName,
      })),
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
  }
}
