import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { Ticket } from './entities/ticket.entity';
import { ProjectsService } from '../projects/projects.service';
import { UsersService } from '../users/users.service';
import { TicketStatus } from '../common/enums/ticket-status.enum';
import { TicketPriority } from '../common/enums/ticket-priority.enum';
import { TicketType } from '../common/enums/ticket-type.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditLog } from '../audit-log/entities/audit-log.entity';

function makeTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    title: 't',
    description: 'd',
    status: TicketStatus.TODO,
    priority: TicketPriority.LOW,
    type: TicketType.BUG,
    projectId: 1,
    assigneeId: null,
    dueDate: null,
    isOverdue: false,
    version: 1,
    deletedByCascade: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...over,
  } as Ticket;
}

describe('TicketsService', () => {
  let service: TicketsService;
  let repo: any;
  let projects: any;
  let users: any;
  let dataSource: any;
  let txTicketRepo: any;
  let txAuditRepo: any;

  beforeEach(async () => {
    // Top-level repo: simulates `@VersionColumn` by bumping `version` on save
    // so tests asserting v1→v2→v3 progression still see the increment.
    repo = {
      create: jest.fn().mockImplementation((d) => ({ id: 1, ...d })),
      save: jest.fn().mockImplementation((t) => {
        t.version = (t.version ?? 0) + 1;
        return Promise.resolve(t);
      }),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      softRemove: jest.fn().mockResolvedValue(undefined),
      restore: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    // Per-transaction repos. The QueryBuilder chain on the ticket repo is
    // only exercised by `softDelete` (setLock + getOne); other tests use
    // the top-level `repo`.
    txTicketRepo = {
      create: jest.fn().mockImplementation((d) => ({ id: 1, ...d })),
      save: jest.fn().mockImplementation((t) => {
        t.version = (t.version ?? 0) + 1;
        return Promise.resolve(t);
      }),
      createQueryBuilder: jest.fn().mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
      }),
    };
    txAuditRepo = { insert: jest.fn().mockResolvedValue(undefined) };
    dataSource = {
      transaction: jest.fn().mockImplementation(async (cb: any) => {
        return cb({
          getRepository: (entity: any) => {
            if (entity === Ticket) return txTicketRepo;
            if (entity === AuditLog) return txAuditRepo;
            return undefined;
          },
        });
      }),
    };

    projects = { existsAndActive: jest.fn().mockResolvedValue(true) };
    users = { existsAndActive: jest.fn().mockResolvedValue(true) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: getRepositoryToken(Ticket), useValue: repo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: ProjectsService, useValue: projects },
        { provide: UsersService, useValue: users },
        {
          provide: AuditLogService,
          useValue: { record: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();
    service = moduleRef.get(TicketsService);
  });

  it('reject create when project is soft-deleted', async () => {
    projects.existsAndActive.mockResolvedValueOnce(false);
    await expect(
      service.create({
        title: 't',
        description: 'd',
        status: TicketStatus.TODO,
        priority: TicketPriority.LOW,
        type: TicketType.BUG,
        projectId: 99,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reject create when assignee is soft-deleted', async () => {
    users.existsAndActive.mockResolvedValueOnce(false);
    await expect(
      service.create({
        title: 't',
        description: 'd',
        status: TicketStatus.TODO,
        priority: TicketPriority.LOW,
        type: TicketType.BUG,
        projectId: 1,
        assigneeId: 5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update on DONE ticket → 403', async () => {
    repo.findOne.mockResolvedValueOnce(
      makeTicket({ status: TicketStatus.DONE }),
    );
    await expect(service.update(1, {}, null, 1)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('update with stale expectedVersion → 412', async () => {
    repo.findOne.mockResolvedValueOnce(makeTicket({ version: 3 }));
    await expect(service.update(1, {}, null, 1)).rejects.toBeInstanceOf(
      PreconditionFailedException,
    );
  });

  it('forward-only status: rejects backward transition', async () => {
    repo.findOne.mockResolvedValueOnce(
      makeTicket({ status: TicketStatus.IN_REVIEW }),
    );
    await expect(
      service.update(1, { status: TicketStatus.IN_PROGRESS }, null, 1),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forward status + version bump on success', async () => {
    const ticket = makeTicket({ status: TicketStatus.TODO, version: 2 });
    repo.findOne.mockResolvedValueOnce(ticket);
    const updated = await service.update(
      1,
      { status: TicketStatus.IN_PROGRESS },
      null,
      2,
    );
    expect(updated.status).toBe(TicketStatus.IN_PROGRESS);
    expect(updated.version).toBe(3);
  });

  it('update() bumps version across successive calls (1 → 2 → 3)', async () => {
    const ticket = makeTicket({ version: 1 });
    repo.findOne.mockResolvedValueOnce(ticket);
    const first = await service.update(1, { title: 'first' }, null, 1);
    expect(first.version).toBe(2);
    expect(first.title).toBe('first');

    repo.findOne.mockResolvedValueOnce(first);
    const second = await service.update(1, { title: 'second' }, null, 2);
    expect(second.version).toBe(3);
    expect(second.title).toBe('second');
  });

  it('manual priority change clears isOverdue without pausing escalation', async () => {
    const ticket = makeTicket({
      priority: TicketPriority.LOW,
      isOverdue: true,
    });
    repo.findOne.mockResolvedValueOnce(ticket);
    const updated = await service.update(
      1,
      { priority: TicketPriority.HIGH },
      null,
      1,
    );
    expect(updated.priority).toBe(TicketPriority.HIGH);
    expect(updated.isOverdue).toBe(false);
    // Field is gone from the entity; the persisted row must not carry it.
    expect(
      (updated as unknown as Record<string, unknown>).autoEscalationPaused,
    ).toBe(undefined);
  });

  it('findAllForProject throws NotFoundException for an unknown project', async () => {
    projects.existsAndActive.mockResolvedValueOnce(false);
    await expect(service.findAllForProject(999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('blocked DONE transition surfaces an error from the resolver', async () => {
    const ticket = makeTicket({ status: TicketStatus.IN_REVIEW });
    repo.findOne.mockResolvedValueOnce(ticket);
    service.registerBlockersResolver({
      assertBlockersResolvedForDone: jest
        .fn()
        .mockRejectedValueOnce(new ConflictException('blocked')),
    });
    await expect(
      service.update(1, { status: TicketStatus.DONE }, null, 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('softDelete with stale expectedVersion → 412', async () => {
    txTicketRepo.createQueryBuilder.mockReturnValueOnce({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValueOnce(makeTicket({ version: 4 })),
    });
    await expect(service.softDelete(1, null, 1)).rejects.toBeInstanceOf(
      PreconditionFailedException,
    );
  });

  it('cascade-soft-delete-for-project marks tickets with deletedByCascade + parent deletedAt', async () => {
    const tickets = [makeTicket({ id: 1 }), makeTicket({ id: 2 })];
    repo.find.mockResolvedValueOnce(tickets);
    await service.cascadeSoftDeleteForProject(10);
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.anything() }),
      expect.objectContaining({
        deletedByCascade: true,
        deletedAt: expect.any(Date),
      }),
    );
  });
});
