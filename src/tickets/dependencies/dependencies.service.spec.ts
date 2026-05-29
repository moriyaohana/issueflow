import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DependenciesService } from './dependencies.service';
import { TicketDependency } from './entities/ticket-dependency.entity';
import { Ticket } from '../entities/ticket.entity';
import { TicketsService } from '../tickets.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditLog } from '../../audit-log/entities/audit-log.entity';
import { TicketStatus } from '../../common/enums/ticket-status.enum';
import { AuditAction } from '../../common/enums/audit-action.enum';
import { EntityType } from '../../common/enums/entity-type.enum';
import { ActorType } from '../../common/enums/actor-type.enum';

describe('DependenciesService', () => {
  let service: DependenciesService;
  let depsRepo: any;
  let ticketsRepo: any;
  let ticketsService: { assertActive: jest.Mock };
  let audit: { record: jest.Mock };
  let dataSource: any;
  let txTicketRepo: any;
  let txDepsRepo: any;
  let txAuditRepo: any;

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
    ticketsService = { assertActive: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const ticketQbDefault = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    txTicketRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(ticketQbDefault),
      findOne: jest.fn(),
      __qb: ticketQbDefault,
    };
    txDepsRepo = {
      findOne: jest.fn(),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    txAuditRepo = { insert: jest.fn().mockResolvedValue(undefined) };

    dataSource = {
      transaction: jest.fn().mockImplementation(async (cb: any) => {
        return cb({
          getRepository: (entity: any) => {
            if (entity === Ticket) return txTicketRepo;
            if (entity === TicketDependency) return txDepsRepo;
            if (entity === AuditLog) return txAuditRepo;
            return undefined;
          },
        });
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DependenciesService,
        { provide: getRepositoryToken(TicketDependency), useValue: depsRepo },
        { provide: getRepositoryToken(Ticket), useValue: ticketsRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: TicketsService, useValue: ticketsService },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(DependenciesService);
  });

  it('self-dependency rejected with 400', async () => {
    await expect(service.add(5, 5)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cross-project rejected with 400', async () => {
    txTicketRepo.__qb.getOne.mockResolvedValueOnce({ id: 1, projectId: 10 });
    txTicketRepo.findOne.mockResolvedValueOnce({ id: 2, projectId: 20 });
    await expect(service.add(1, 2)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('duplicate dependency rejected with 409', async () => {
    txTicketRepo.__qb.getOne.mockResolvedValueOnce({ id: 1, projectId: 10 });
    txTicketRepo.findOne.mockResolvedValueOnce({ id: 2, projectId: 10 });
    txDepsRepo.findOne.mockResolvedValueOnce({ id: 99 });
    await expect(service.add(1, 2)).rejects.toBeInstanceOf(ConflictException);
  });

  it('soft-deleted ticket rejected with 404', async () => {
    await expect(service.add(1, 2)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DONE transition blocked when blocker is not DONE', async () => {
    depsRepo.find.mockResolvedValueOnce([{ ticketId: 1, blockedBy: 2 }]);
    ticketsRepo.find.mockResolvedValueOnce([
      { id: 2, status: TicketStatus.IN_PROGRESS },
    ]);
    await expect(
      service.assertBlockersResolvedForDone(1),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('DONE transition allowed when all blockers DONE', async () => {
    depsRepo.find.mockResolvedValueOnce([{ ticketId: 1, blockedBy: 2 }]);
    ticketsRepo.find.mockResolvedValueOnce([
      { id: 2, status: TicketStatus.DONE },
    ]);
    await expect(
      service.assertBlockersResolvedForDone(1),
    ).resolves.toBeUndefined();
  });

  describe('cascadeSoftDeleteDependencies', () => {
    function mockCascadeRows(
      rows: { id: number; ticketId: number; blockedBy: number }[],
    ) {
      const updateBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: rows.length }),
      };
      depsRepo.createQueryBuilder.mockImplementation((alias?: string) => {
        if (alias === 'd') {
          return {
            select: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockResolvedValue(rows),
          };
        }
        return updateBuilder;
      });
      return updateBuilder;
    }

    it('emits one DELETE audit row per removed dependency', async () => {
      mockCascadeRows([
        { id: 11, ticketId: 1, blockedBy: 2 },
        { id: 12, ticketId: 3, blockedBy: 1 },
      ]);
      await service.cascadeSoftDeleteDependencies([1], 42);
      expect(audit.record).toHaveBeenCalledTimes(2);
      expect(audit.record).toHaveBeenNthCalledWith(1, {
        action: AuditAction.DELETE,
        entityType: EntityType.DEPENDENCY,
        entityId: 11,
        performedBy: 42,
        actor: ActorType.USER,
        metadata: { cascade: 'soft', ticketIds: [1] },
      });
      expect(audit.record).toHaveBeenNthCalledWith(2, {
        action: AuditAction.DELETE,
        entityType: EntityType.DEPENDENCY,
        entityId: 12,
        performedBy: 42,
        actor: ActorType.USER,
        metadata: { cascade: 'soft', ticketIds: [1] },
      });
    });

    it('uses ActorType.SYSTEM when actorUserId is null', async () => {
      mockCascadeRows([
        { id: 21, ticketId: 5, blockedBy: 6 },
        { id: 22, ticketId: 7, blockedBy: 5 },
      ]);
      await service.cascadeSoftDeleteDependencies([5], null);
      expect(audit.record).toHaveBeenCalledTimes(2);
      for (const call of audit.record.mock.calls) {
        expect(call[0]).toMatchObject({
          actor: ActorType.SYSTEM,
          performedBy: null,
        });
      }
    });

    it('uses ActorType.USER when actorUserId is non-null', async () => {
      mockCascadeRows([{ id: 31, ticketId: 9, blockedBy: 10 }]);
      await service.cascadeSoftDeleteDependencies([9], 7);
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record.mock.calls[0][0]).toMatchObject({
        actor: ActorType.USER,
        performedBy: 7,
      });
    });

    it('is a no-op when no dependencies match', async () => {
      const updateBuilder = mockCascadeRows([]);
      await service.cascadeSoftDeleteDependencies([99], 1);
      expect(audit.record).not.toHaveBeenCalled();
      expect(updateBuilder.execute).not.toHaveBeenCalled();
    });
  });
});
