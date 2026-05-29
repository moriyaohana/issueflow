import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { Comment } from './entities/comment.entity';
import { Mention } from './entities/mention.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { MentionParser } from './mentions/mention-parser';
import { TicketsService } from '../tickets/tickets.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { actorOf } from '../audit-log/audit-log.helpers';
import { AuditAction } from '../common/enums/audit-action.enum';
import { EntityType } from '../common/enums/entity-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { liveOnly } from '../common/utils/live-only';
import { assertVersionMatches } from '../common/utils/version';
import { entityNotFound } from '../common/errors/messages';

export interface CommentActor {
  id: number;
  role: UserRole;
}

// Carries `version` so the controller can emit the ETag header; the wire DTO
// drops it.
export interface CommentResponse {
  id: number;
  ticketId: number;
  authorId: number;
  content: string;
  mentionedUsers: { id: number; username: string; fullName: string }[];
  version: number;
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
    await this.tickets.assertActive(ticketId);
    await this.users.assertActive(dto.authorId);
    const mentioned = await this.mentionParser.resolve(dto.content);
    const saved = await this.dataSource.transaction(async (manager) => {
      const commentRepo = manager.getRepository(Comment);
      const inserted = await commentRepo.save(
        commentRepo.create({
          ticketId,
          authorId: dto.authorId,
          content: dto.content,
        }),
      );
      if (mentioned.length > 0) {
        await manager
          .getRepository(Mention)
          .insert(
            mentioned.map((u) => ({ commentId: inserted.id, userId: u.id })),
          );
      }
      await this.audit.record({
        action: AuditAction.CREATE,
        entityType: EntityType.COMMENT,
        entityId: inserted.id,
        ...actorOf(actorUserId),
        metadata: { ticketId, mentionedUserIds: mentioned.map((u) => u.id) },
      });
      return inserted;
    });
    return this.toResponse(saved, mentioned);
  }

  async update(
    routeTicketId: number,
    commentId: number,
    dto: UpdateCommentDto,
    actor: CommentActor | null,
    expectedVersion: number,
  ): Promise<CommentResponse> {
    const response = await this.dataSource.transaction(async (manager) => {
      const comment = await manager
        .getRepository(Comment)
        .findOne({ where: { id: commentId } });
      if (!comment) {
        throw new NotFoundException(
          entityNotFound(EntityType.COMMENT, commentId),
        );
      }
      // 404 on ticket mismatch to avoid leaking comment existence under a
      // different ticket id.
      if (comment.ticketId !== routeTicketId) {
        throw new NotFoundException(
          entityNotFound(EntityType.COMMENT, commentId),
        );
      }
      // null actor = trusted internal caller (cascade flows).
      if (
        actor &&
        comment.authorId !== actor.id &&
        actor.role !== UserRole.ADMIN
      ) {
        throw new ForbiddenException('Not the author of this comment');
      }
      assertVersionMatches(comment, expectedVersion, 'Comment');

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
        await manager
          .getRepository(Mention)
          .insert(toAdd.map((userId) => ({ commentId, userId })));
      }
      await this.audit.record({
        action: AuditAction.UPDATE,
        entityType: EntityType.COMMENT,
        entityId: commentId,
        ...actorOf(actor?.id ?? null),
      });
      return this.toResponse(comment, newMentions);
    });
    return response;
  }

  async delete(
    routeTicketId: number,
    commentId: number,
    actor: CommentActor | null,
    expectedVersion: number,
  ): Promise<void> {
    const comment = await this.comments.findOne({ where: { id: commentId } });
    if (!comment) {
      throw new NotFoundException(
        entityNotFound(EntityType.COMMENT, commentId),
      );
    }
    // 404 on ticket mismatch to avoid leaking comment existence.
    if (comment.ticketId !== routeTicketId) {
      throw new NotFoundException(
        entityNotFound(EntityType.COMMENT, commentId),
      );
    }
    if (
      actor &&
      comment.authorId !== actor.id &&
      actor.role !== UserRole.ADMIN
    ) {
      throw new ForbiddenException('Not the author of this comment');
    }
    assertVersionMatches(comment, expectedVersion, 'Comment');
    await this.comments.softDelete(commentId);
    // `mentions` has no `deletedAt`; hard-delete here and re-insert on restore
    // so rows can't dangle at a hidden comment.
    await this.mentions.delete({ commentId });
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: EntityType.COMMENT,
      entityId: commentId,
      ...actorOf(actor?.id ?? null),
    });
  }

  async findForTicket(ticketId: number): Promise<CommentResponse[]> {
    await this.tickets.assertActive(ticketId);
    const rows = await this.comments.find({
      where: { ticketId, deletedAt: IsNull() },
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
    // limit/offset (not skip/take): TypeORM's skip/take wraps the query in a
    // DISTINCT subquery that can't ORDER BY joined columns.
    const baseQb = () =>
      this.mentions
        .createQueryBuilder('m')
        .innerJoin(Comment, 'c', 'c.id = m.commentId AND c.deletedAt IS NULL')
        .where('m.userId = :userId', { userId });
    const total = await baseQb().getCount();
    const mentionRows = await baseQb()
      .orderBy('c.createdAt', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .limit(take)
      .offset(skip)
      .getMany();
    if (mentionRows.length === 0) {
      return { data: [], total, page };
    }
    const commentIds = mentionRows.map((m) => m.commentId);
    const comments = await this.comments.find({
      where: { id: In(commentIds), deletedAt: IsNull() },
    });
    const byId = new Map(comments.map((c) => [c.id, c]));
    const ordered: Comment[] = [];
    for (const m of mentionRows) {
      const c = byId.get(m.commentId);
      if (c) ordered.push(c);
    }
    const data = await Promise.all(
      ordered.map((c) => this.toResponseWithLookup(c)),
    );
    return { data, total, page };
  }

  async cascadeSoftDeleteComments(
    ticketIds: number[],
    actorUserId: number | null = null,
  ): Promise<void> {
    if (ticketIds.length === 0) return;
    const rows = await this.comments.find({
      where: { ticketId: In(ticketIds), deletedAt: IsNull() },
      select: ['id'],
    });
    if (rows.length === 0) return;
    await this.comments
      .createQueryBuilder()
      .update(Comment)
      .set({ deletedAt: new Date(), deletedByCascade: true })
      .where('ticketId IN (:...ticketIds)', { ticketIds })
      .andWhere('deletedAt IS NULL')
      .execute();
    await this.mentions.delete({ commentId: In(rows.map((r) => r.id)) });
    for (const r of rows) {
      await this.audit.record({
        action: AuditAction.DELETE,
        entityType: EntityType.COMMENT,
        entityId: r.id,
        ...actorOf(actorUserId),
        metadata: { cascade: 'soft', ticketIds },
      });
    }
  }

  async cascadeRestoreComments(
    ticketIds: number[],
    actorUserId: number | null = null,
  ): Promise<void> {
    if (ticketIds.length === 0) return;
    const rows = await this.comments.find({
      where: { ticketId: In(ticketIds), deletedByCascade: true },
      select: ['id', 'content'],
      withDeleted: true,
    });
    if (rows.length === 0) return;
    await this.comments
      .createQueryBuilder()
      .update(Comment)
      .set({ deletedAt: null, deletedByCascade: false })
      .where('ticketId IN (:...ticketIds)', { ticketIds })
      .andWhere('deletedByCascade = TRUE')
      .execute();
    for (const r of rows) {
      const mentioned = await this.mentionParser.resolve(r.content);
      if (mentioned.length > 0) {
        await this.mentions.insert(
          mentioned.map((u) => ({ commentId: r.id, userId: u.id })),
        );
      }
    }
    for (const r of rows) {
      await this.audit.record({
        action: AuditAction.RESTORE,
        entityType: EntityType.COMMENT,
        entityId: r.id,
        ...actorOf(actorUserId),
        metadata: { cascade: 'soft', ticketIds },
      });
    }
  }

  private async toResponseWithLookup(
    comment: Comment,
  ): Promise<CommentResponse> {
    const rows = await this.mentions.find({ where: { commentId: comment.id } });
    const ids = rows.map((r) => r.userId);
    if (ids.length === 0) return this.toResponse(comment, []);
    const users = await this.userRepo.find({
      where: liveOnly<User>({ id: In(ids) }),
    });
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
    };
  }
}
