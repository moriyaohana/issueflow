import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
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
  version: number;
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
      throw new BadRequestException(
        `Author ${dto.authorId} is missing or deleted`,
      );
    }
    const saved = await this.comments.save(
      this.comments.create({
        ticketId,
        authorId: dto.authorId,
        content: dto.content,
      }),
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
   * Update with HTTP-level optimistic concurrency.
   *
   * The caller passes the version they observed (via `If-Match`); we compare
   * against the row's current `version`, bump it on save, and surface a
   * 412 Precondition Failed if they raced another writer. The mention diff
   * + comment save stay inside a transaction so the row and its mentions
   * commit atomically, but no row lock is taken — concurrent writers fail
   * loud at the version check rather than serialising on a lock.
   */
  async update(
    commentId: number,
    dto: UpdateCommentDto,
    actorUserId: number | null,
    expectedVersion: number,
  ): Promise<CommentResponse> {
    const response = await this.dataSource.transaction(async (manager) => {
      const comment = await manager
        .getRepository(Comment)
        .findOne({ where: { id: commentId } });
      if (!comment)
        throw new NotFoundException(`Comment ${commentId} not found`);
      if (expectedVersion !== comment.version) {
        throw new PreconditionFailedException({
          message: 'Version mismatch',
          currentVersion: comment.version,
        });
      }

      comment.content = dto.content;
      comment.version += 1;
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
        await manager
          .getRepository(Mention)
          .insert(toAdd.map((userId) => ({ commentId, userId })));
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
  }

  async delete(
    commentId: number,
    actorUserId: number | null,
    expectedVersion: number,
  ): Promise<void> {
    const comment = await this.comments.findOne({ where: { id: commentId } });
    if (!comment) throw new NotFoundException(`Comment ${commentId} not found`);
    if (expectedVersion !== comment.version) {
      throw new PreconditionFailedException({
        message: 'Version mismatch',
        currentVersion: comment.version,
      });
    }
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
    const data = await Promise.all(
      comments.map((c) => this.toResponseWithLookup(c)),
    );
    return { data, total, page };
  }

  /** Cascade hook fired by TicketsService.softDelete (and project cascade). */
  async cascadeHardDeleteComments(
    ticketIds: number[],
    actorUserId: number | null = null,
  ): Promise<void> {
    if (ticketIds.length === 0) return;
    const ids = (
      await this.comments.find({
        where: { ticketId: In(ticketIds) },
        select: ['id'],
      })
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

  private async toResponseWithLookup(
    comment: Comment,
  ): Promise<CommentResponse> {
    const rows = await this.mentions.find({ where: { commentId: comment.id } });
    const ids = rows.map((r) => r.userId);
    if (ids.length === 0) return this.toResponse(comment, []);
    const users = await this.userRepo.find({ where: { id: In(ids) } });
    return this.toResponse(
      comment,
      users.map((u) => ({
        id: u.id,
        username: u.username,
        fullName: u.fullName,
      })),
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
      version: comment.version,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
  }
}
