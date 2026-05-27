import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { Ticket } from './entities/ticket.entity';
import { ProjectsService } from '../projects/projects.service';
import { UsersService } from '../users/users.service';
import { TicketStatus } from '../common/enums/ticket-status.enum';
import { TicketPriority } from '../common/enums/ticket-priority.enum';
import { TicketType } from '../common/enums/ticket-type.enum';
import { AuditLogService } from '../audit-log/audit-log.service';

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
    autoEscalationPaused: false,
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

  beforeEach(async () => {
    repo = {
      create: jest.fn().mockImplementation((d) => ({ id: 1, ...d })),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      softRemove: jest.fn().mockResolvedValue(undefined),
      restore: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      count: jest.fn(),
    };
    projects = { existsAndActive: jest.fn().mockResolvedValue(true) };
    users = { existsAndActive: jest.fn().mockResolvedValue(true) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: getRepositoryToken(Ticket), useValue: repo },
        { provide: ProjectsService, useValue: projects },
        { provide: UsersService, useValue: users },
        { provide: AuditLogService, useValue: { record: jest.fn().mockResolvedValue(undefined) } },
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
    repo.findOne.mockResolvedValueOnce(makeTicket({ status: TicketStatus.DONE }));
    await expect(service.update(1, { version: 1 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('update with stale version → 409', async () => {
    repo.findOne.mockResolvedValueOnce(makeTicket({ version: 3 }));
    await expect(service.update(1, { version: 1 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('forward-only status: rejects backward transition', async () => {
    repo.findOne.mockResolvedValueOnce(makeTicket({ status: TicketStatus.IN_REVIEW }));
    await expect(
      service.update(1, { version: 1, status: TicketStatus.IN_PROGRESS }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forward status + version bump on success', async () => {
    const ticket = makeTicket({ status: TicketStatus.TODO, version: 2 });
    repo.findOne.mockResolvedValueOnce(ticket);
    const updated = await service.update(1, { version: 2, status: TicketStatus.IN_PROGRESS });
    expect(updated.status).toBe(TicketStatus.IN_PROGRESS);
    expect(updated.version).toBe(3);
  });

  it('manual priority change pauses escalation and clears isOverdue', async () => {
    const ticket = makeTicket({
      priority: TicketPriority.LOW,
      autoEscalationPaused: false,
      isOverdue: true,
    });
    repo.findOne.mockResolvedValueOnce(ticket);
    const updated = await service.update(1, { version: 1, priority: TicketPriority.HIGH });
    expect(updated.priority).toBe(TicketPriority.HIGH);
    expect(updated.autoEscalationPaused).toBe(true);
    expect(updated.isOverdue).toBe(false);
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
      service.update(1, { version: 1, status: TicketStatus.DONE }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cascade-soft-delete-for-project sets deletedByCascade=true and soft-removes', async () => {
    const tickets = [makeTicket({ id: 1 }), makeTicket({ id: 2 })];
    repo.find.mockResolvedValueOnce(tickets);
    await service.cascadeSoftDeleteForProject(10);
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.anything() }),
      { deletedByCascade: true },
    );
    expect(repo.softRemove).toHaveBeenCalledWith(tickets);
  });
});
