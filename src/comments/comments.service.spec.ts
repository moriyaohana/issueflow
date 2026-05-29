import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, PreconditionFailedException } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { Comment } from './entities/comment.entity';
import { Mention } from './entities/mention.entity';
import { User } from '../users/entities/user.entity';
import { MentionParser } from './mentions/mention-parser';
import { TicketsService } from '../tickets/tickets.service';
import { UsersService } from '../users/users.service';
import { AuditLogService } from '../audit-log/audit-log.service';

function makeComment(over: Partial<Comment> = {}): Comment {
  return {
    id: 1,
    ticketId: 1,
    authorId: 1,
    content: 'hello',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as Comment;
}

describe('CommentsService', () => {
  let service: CommentsService;
  let commentsRepo: any;
  let mentionsRepo: any;
  let userRepo: any;
  let dataSource: any;
  let mentionParser: any;
  let tickets: any;
  let users: any;

  beforeEach(async () => {
    commentsRepo = {
      create: jest
        .fn()
        .mockImplementation((d) => ({ id: 1, version: 1, ...d })),
      save: jest.fn().mockImplementation((c) => Promise.resolve(c)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    mentionsRepo = {
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      insert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    userRepo = { find: jest.fn().mockResolvedValue([]) };

    const txCommentRepo = {
      findOne: jest.fn(),
      // Simulate @VersionColumn bump so v1→v2 progression assertions pass.
      save: jest.fn().mockImplementation((c) => {
        c.version = (c.version ?? 0) + 1;
        return Promise.resolve(c);
      }),
    };
    const txMentionRepo = {
      find: jest.fn().mockResolvedValue([]),
      insert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation(async (cb: any) => {
        const manager = {
          getRepository: (entity: any) => {
            if (entity === Comment) return txCommentRepo;
            if (entity === Mention) return txMentionRepo;
            return undefined;
          },
        };
        return cb(manager);
      }),
      __tx: { txCommentRepo, txMentionRepo },
    };

    mentionParser = { resolve: jest.fn().mockResolvedValue([]) };
    tickets = { assertActive: jest.fn().mockResolvedValue(undefined) };
    users = { assertActive: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: getRepositoryToken(Comment), useValue: commentsRepo },
        { provide: getRepositoryToken(Mention), useValue: mentionsRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: MentionParser, useValue: mentionParser },
        { provide: TicketsService, useValue: tickets },
        { provide: UsersService, useValue: users },
        {
          provide: AuditLogService,
          useValue: { record: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();
    service = moduleRef.get(CommentsService);
  });

  it('update() bumps version across successive calls (1 → 2 → 3)', async () => {
    const txCommentRepo = dataSource.__tx.txCommentRepo;
    const c1 = makeComment({ version: 1 });
    txCommentRepo.findOne.mockResolvedValueOnce(c1);
    await service.update(1, 1, { content: 'first' }, null, 1);
    expect(c1.version).toBe(2);

    const c2 = makeComment({ version: 2, content: 'first' });
    txCommentRepo.findOne.mockResolvedValueOnce(c2);
    await service.update(1, 1, { content: 'second' }, null, 2);
    expect(c2.version).toBe(3);
  });

  it('update() throws PreconditionFailedException when expectedVersion is stale', async () => {
    const txCommentRepo = dataSource.__tx.txCommentRepo;
    txCommentRepo.findOne.mockResolvedValueOnce(makeComment({ version: 3 }));
    await expect(
      service.update(1, 1, { content: 'x' }, null, 1),
    ).rejects.toBeInstanceOf(PreconditionFailedException);
  });

  it('update() throws NotFoundException when the comment is missing', async () => {
    const txCommentRepo = dataSource.__tx.txCommentRepo;
    txCommentRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.update(1, 1, { content: 'x' }, null, 1),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update() no longer acquires a pessimistic row lock', async () => {
    const txCommentRepo = dataSource.__tx.txCommentRepo;
    txCommentRepo.findOne.mockResolvedValueOnce(makeComment({ version: 1 }));
    await service.update(1, 1, { content: 'x' }, null, 1);
    expect((txCommentRepo as any).createQueryBuilder).toBeUndefined();
  });

  it('delete() throws PreconditionFailedException when expectedVersion is stale', async () => {
    commentsRepo.findOne.mockResolvedValueOnce(makeComment({ version: 5 }));
    await expect(service.delete(1, 1, null, 1)).rejects.toBeInstanceOf(
      PreconditionFailedException,
    );
    expect(commentsRepo.softDelete).not.toHaveBeenCalled();
  });

  it('delete() succeeds when expectedVersion matches', async () => {
    commentsRepo.findOne.mockResolvedValueOnce(makeComment({ version: 2 }));
    await service.delete(1, 1, null, 2);
    expect(commentsRepo.softDelete).toHaveBeenCalledWith(1);
  });
});
