import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogService } from './audit-log.service';
import { AuditLog } from './entities/audit-log.entity';
import { AuditAction } from '../common/enums/audit-action.enum';
import { EntityType } from '../common/enums/entity-type.enum';
import { ActorType } from '../common/enums/actor-type.enum';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      insert: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: getRepositoryToken(AuditLog), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(AuditLogService);
  });

  it('writes a row matching the input', async () => {
    await service.record({
      action: AuditAction.PROJECT_CREATE,
      entityType: EntityType.PROJECT,
      entityId: 1,
      performedBy: 2,
      actor: ActorType.USER,
      metadata: { foo: 'bar' },
    });
    expect(repo.insert).toHaveBeenCalledWith({
      action: AuditAction.PROJECT_CREATE,
      entityType: EntityType.PROJECT,
      entityId: 1,
      performedBy: 2,
      actor: ActorType.USER,
      metadata: { foo: 'bar' },
    });
  });

  it('swallows insert errors so business flows are not broken', async () => {
    repo.insert.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.record({
        action: AuditAction.PROJECT_CREATE,
        entityType: EntityType.PROJECT,
        entityId: 1,
        performedBy: 2,
        actor: ActorType.USER,
      }),
    ).resolves.toBeUndefined();
  });

  it('find composes filters into the where clause', async () => {
    await service.find({ entityType: EntityType.TICKET, actor: ActorType.SYSTEM });
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityType: EntityType.TICKET, actor: ActorType.SYSTEM },
      }),
    );
  });
});
