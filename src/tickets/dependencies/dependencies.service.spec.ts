import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DependenciesService } from './dependencies.service';
import { TicketDependency } from './entities/ticket-dependency.entity';
import { Ticket } from '../entities/ticket.entity';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { TicketStatus } from '../../common/enums/ticket-status.enum';

describe('DependenciesService', () => {
  let service: DependenciesService;
  let depsRepo: any;
  let ticketsRepo: any;

  beforeEach(async () => {
    depsRepo = {
      insert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    ticketsRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        DependenciesService,
        { provide: getRepositoryToken(TicketDependency), useValue: depsRepo },
        { provide: getRepositoryToken(Ticket), useValue: ticketsRepo },
        { provide: AuditLogService, useValue: { record: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = moduleRef.get(DependenciesService);
  });

  it('self-dependency rejected with 400', async () => {
    await expect(service.add(5, 5)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cross-project rejected with 400', async () => {
    ticketsRepo.findOne
      .mockResolvedValueOnce({ id: 1, projectId: 10 })
      .mockResolvedValueOnce({ id: 2, projectId: 20 });
    await expect(service.add(1, 2)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('duplicate dependency rejected with 409', async () => {
    ticketsRepo.findOne
      .mockResolvedValueOnce({ id: 1, projectId: 10 })
      .mockResolvedValueOnce({ id: 2, projectId: 10 });
    depsRepo.findOne.mockResolvedValueOnce({ id: 99 });
    await expect(service.add(1, 2)).rejects.toBeInstanceOf(ConflictException);
  });

  it('soft-deleted ticket rejected with 404', async () => {
    ticketsRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.add(1, 2)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DONE transition blocked when blocker is not DONE', async () => {
    depsRepo.find.mockResolvedValueOnce([{ ticketId: 1, blockerId: 2 }]);
    ticketsRepo.find.mockResolvedValueOnce([{ id: 2, status: TicketStatus.IN_PROGRESS }]);
    await expect(service.assertBlockersResolvedForDone(1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('DONE transition allowed when all blockers DONE', async () => {
    depsRepo.find.mockResolvedValueOnce([{ ticketId: 1, blockerId: 2 }]);
    ticketsRepo.find.mockResolvedValueOnce([{ id: 2, status: TicketStatus.DONE }]);
    await expect(service.assertBlockersResolvedForDone(1)).resolves.toBeUndefined();
  });
});
