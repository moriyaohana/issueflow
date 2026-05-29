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
import { AuditAction } from '../../common/enums/audit-action.enum';
import { EntityType } from '../../common/enums/entity-type.enum';
import { ActorType } from '../../common/enums/actor-type.enum';

describe('DependenciesService', () => {
  let service: DependenciesService;
  let depsRepo: any;
  let ticketsRepo: any;
  let audit: { record: jest.Mock };

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
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        DependenciesService,
        { provide: getRepositoryToken(TicketDependency), useValue: depsRepo },
        { provide: getRepositoryToken(Ticket), useValue: ticketsRepo },
        { provide: AuditLogService, useValue: audit },
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
    ticketsRepo.find.mockResolvedValueOnce([
      { id: 2, status: TicketStatus.IN_PROGRESS },
    ]);
    await expect(
      service.assertBlockersResolvedForDone(1),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('DONE transition allowed when all blockers DONE', async () => {
    depsRepo.find.mockResolvedValueOnce([{ ticketId: 1, blockerId: 2 }]);
    ticketsRepo.find.mockResolvedValueOnce([
      { id: 2, status: TicketStatus.DONE },
    ]);
    await expect(
      service.assertBlockersResolvedForDone(1),
    ).resolves.toBeUndefined();
  });

  describe('cascadeHardDeleteDependencies', () => {
    function mockCascadeRows(
      rows: { id: number; ticketId: number; blockerId: number }[],
    ) {
      depsRepo.createQueryBuilder.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(rows),
      });
    }

    it('emits one DEPENDENCY_DELETE audit row per removed dependency', async () => {
      mockCascadeRows([
        { id: 11, ticketId: 1, blockerId: 2 },
        { id: 12, ticketId: 3, blockerId: 1 },
      ]);
      await service.cascadeHardDeleteDependencies([1], 42);
      expect(audit.record).toHaveBeenCalledTimes(2);
      expect(audit.record).toHaveBeenNthCalledWith(1, {
        action: AuditAction.DEPENDENCY_DELETE,
        entityType: EntityType.DEPENDENCY,
        entityId: 11,
        performedBy: 42,
        actor: ActorType.USER,
        metadata: { cascade: true, ticketIds: [1] },
      });
      expect(audit.record).toHaveBeenNthCalledWith(2, {
        action: AuditAction.DEPENDENCY_DELETE,
        entityType: EntityType.DEPENDENCY,
        entityId: 12,
        performedBy: 42,
        actor: ActorType.USER,
        metadata: { cascade: true, ticketIds: [1] },
      });
    });

    it('uses ActorType.SYSTEM when actorUserId is null', async () => {
      mockCascadeRows([
        { id: 21, ticketId: 5, blockerId: 6 },
        { id: 22, ticketId: 7, blockerId: 5 },
      ]);
      await service.cascadeHardDeleteDependencies([5], null);
      expect(audit.record).toHaveBeenCalledTimes(2);
      for (const call of audit.record.mock.calls) {
        expect(call[0]).toMatchObject({
          actor: ActorType.SYSTEM,
          performedBy: null,
        });
      }
    });

    it('uses ActorType.USER when actorUserId is non-null', async () => {
      mockCascadeRows([{ id: 31, ticketId: 9, blockerId: 10 }]);
      await service.cascadeHardDeleteDependencies([9], 7);
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record.mock.calls[0][0]).toMatchObject({
        actor: ActorType.USER,
        performedBy: 7,
      });
    });

    it('is a no-op when no dependencies match', async () => {
      mockCascadeRows([]);
      await service.cascadeHardDeleteDependencies([99], 1);
      expect(audit.record).not.toHaveBeenCalled();
      expect(depsRepo.delete).not.toHaveBeenCalled();
    });
  });
});
