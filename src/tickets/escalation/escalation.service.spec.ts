import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EscalationService } from './escalation.service';
import { Ticket } from '../entities/ticket.entity';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { TicketPriority } from '../../common/enums/ticket-priority.enum';
import { TicketStatus } from '../../common/enums/ticket-status.enum';

function makeTicket(p: Partial<Ticket>): Ticket {
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
    autoEscalationPaused: false,
    version: 1,
    deletedByCascade: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...p,
  } as Ticket;
}

describe('EscalationService', () => {
  let service: EscalationService;
  let repo: any;
  let auditCall: jest.Mock;

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };
    auditCall = jest.fn().mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        EscalationService,
        { provide: getRepositoryToken(Ticket), useValue: repo },
        { provide: AuditLogService, useValue: { record: auditCall } },
      ],
    }).compile();
    service = moduleRef.get(EscalationService);
  });

  it('promotes LOW → MEDIUM and bumps version', async () => {
    const t = makeTicket({ priority: TicketPriority.LOW, version: 2 });
    repo.find.mockResolvedValueOnce([t]);
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
    repo.find.mockResolvedValueOnce([t]);
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
    repo.find.mockResolvedValueOnce([t]);
    const affected = await service.runEscalation();
    expect(affected).toBe(0);
    expect(t.version).toBe(5);
    expect(auditCall).not.toHaveBeenCalled();
  });
});
