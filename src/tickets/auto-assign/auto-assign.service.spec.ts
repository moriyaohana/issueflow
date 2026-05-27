import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AutoAssignService } from './auto-assign.service';
import { User } from '../../users/entities/user.entity';
import { Ticket } from '../entities/ticket.entity';

describe('AutoAssignService', () => {
  let service: AutoAssignService;
  let usersRepo: any;
  let qb: any;

  beforeEach(async () => {
    qb = {
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(),
      getRawMany: jest.fn(),
    };
    usersRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AutoAssignService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(Ticket), useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(AutoAssignService);
  });

  it('returns null when no developer found', async () => {
    qb.getRawOne.mockResolvedValueOnce(undefined);
    const id = await service.pickAssignee(1);
    expect(id).toBeNull();
  });

  it('returns the least-loaded developer id (coerces string→number)', async () => {
    qb.getRawOne.mockResolvedValueOnce({ id: '7', load: '0' });
    const id = await service.pickAssignee(1);
    expect(id).toBe(7);
  });

  it('getProjectWorkload coerces counts to numbers and preserves order', async () => {
    qb.getRawMany.mockResolvedValueOnce([
      { userId: '1', username: 'a', openTicketCount: '0' },
      { userId: '2', username: 'b', openTicketCount: '5' },
    ]);
    const list = await service.getProjectWorkload(1);
    expect(list).toEqual([
      { userId: 1, username: 'a', openTicketCount: 0 },
      { userId: 2, username: 'b', openTicketCount: 5 },
    ]);
  });
});
