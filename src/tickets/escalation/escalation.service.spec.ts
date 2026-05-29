import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { EscalationService } from './escalation.service';
import { Ticket } from '../entities/ticket.entity';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { TicketPriority } from '../../common/enums/ticket-priority.enum';
import { TicketStatus } from '../../common/enums/ticket-status.enum';

function makeTicket(overrides: Partial<Ticket>): Ticket {
  return {
    id: 1,
    title: 't',
    description: 'd',
    status: TicketStatus.TODO,
    priority: TicketPriority.LOW,
    type: 'BUG' as any,
    projectId: 1,
    assigneeId: null,
    dueDate: new Date(Date.now() - 60_000),
    isOverdue: false,
    version: 1,
    deletedByCascade: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as Ticket;
}

/**
 * Mock the bulk-UPDATE QueryBuilder chain used by `runEscalation`. We don't
 * care about the SQL it would generate; we only need the chain to resolve
 * without throwing so the in-memory mutation pass at the end of
 * `runEscalation` runs and the audit-record fan-out fires.
 */
function makeUpdateBuilder() {
  return {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
  };
}

describe('EscalationService', () => {
  let service: EscalationService;
  let repo: any;
  let txTicketRepo: any;
  let dataSource: any;
  let auditCall: jest.Mock;

  beforeEach(async () => {
    // The find query is now a QueryBuilder (`createQueryBuilder('t')` +
    // `where/andWhere/getMany`); mock the same shape.
    const selectChain = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    repo = {
      createQueryBuilder: jest.fn().mockReturnValue(selectChain),
      __selectChain: selectChain,
    };

    txTicketRepo = {
      createQueryBuilder: jest.fn().mockImplementation(() => makeUpdateBuilder()),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation(async (cb: any) => {
        return cb({
          getRepository: (entity: any) => {
            if (entity === Ticket) return txTicketRepo;
            return undefined;
          },
        });
      }),
    };

    auditCall = jest.fn().mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        EscalationService,
        { provide: getRepositoryToken(Ticket), useValue: repo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: AuditLogService, useValue: { record: auditCall } },
      ],
    }).compile();
    service = moduleRef.get(EscalationService);
  });

  it('promotes LOW → MEDIUM and bumps version', async () => {
    const t = makeTicket({ priority: TicketPriority.LOW, version: 2 });
    repo.__selectChain.getMany.mockResolvedValueOnce([t]);
    const affected = await service.runEscalation();
    expect(affected).toBe(1);
    expect(t.priority).toBe(TicketPriority.MEDIUM);
    expect(t.version).toBe(3);
    expect(auditCall).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTO_ESCALATE' }),
    );
  });

  it('CRITICAL stays CRITICAL but flips isOverdue', async () => {
    const t = makeTicket({
      priority: TicketPriority.CRITICAL,
      isOverdue: false,
      version: 1,
    });
    repo.__selectChain.getMany.mockResolvedValueOnce([t]);
    const affected = await service.runEscalation();
    expect(affected).toBe(1);
    expect(t.priority).toBe(TicketPriority.CRITICAL);
    expect(t.isOverdue).toBe(true);
    expect(t.version).toBe(2);
  });

  it('idempotent at CRITICAL with isOverdue=true (no save, no audit)', async () => {
    const t = makeTicket({
      priority: TicketPriority.CRITICAL,
      isOverdue: true,
      version: 5,
    });
    repo.__selectChain.getMany.mockResolvedValueOnce([t]);
    const affected = await service.runEscalation();
    expect(affected).toBe(0);
    expect(t.version).toBe(5);
    expect(auditCall).not.toHaveBeenCalled();
  });

  it('HIGH → CRITICAL flips isOverdue in the same tick (#37)', async () => {
    const t = makeTicket({
      priority: TicketPriority.HIGH,
      isOverdue: false,
      version: 1,
    });
    repo.__selectChain.getMany.mockResolvedValueOnce([t]);
    const affected = await service.runEscalation();
    expect(affected).toBe(1);
    expect(t.priority).toBe(TicketPriority.CRITICAL);
    expect(t.isOverdue).toBe(true);
    expect(t.version).toBe(2);
    expect(auditCall).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AUTO_ESCALATE',
        metadata: expect.objectContaining({
          priorityFrom: TicketPriority.HIGH,
          priorityTo: TicketPriority.CRITICAL,
          isOverdueFrom: false,
          isOverdueTo: true,
        }),
      }),
    );
  });
});
