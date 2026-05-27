import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Ticket } from '../entities/ticket.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { TicketStatus } from '../../common/enums/ticket-status.enum';

export interface WorkloadEntry {
  userId: number;
  username: string;
  openTicketCount: number;
}

@Injectable()
export class AutoAssignService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
  ) {}

  /**
   * Picks the least-loaded active DEVELOPER in the project. Tie-break is the
   * oldest `createdAt`. Returns `null` when no developer is available.
   *
   * Workload = count of non-DONE, non-deleted tickets assigned to the user
   * inside that project. Admins are excluded because the role is
   * intentionally separate from delivery work.
   */
  async pickAssignee(projectId: number): Promise<number | null> {
    const rows = await this.users
      .createQueryBuilder('u')
      .leftJoin(
        Ticket,
        't',
        't."assigneeId" = u.id AND t."projectId" = :projectId AND t.status <> :done AND t."deletedAt" IS NULL',
        { projectId, done: TicketStatus.DONE },
      )
      .where('u.role = :role AND u."deletedAt" IS NULL', { role: UserRole.DEVELOPER })
      .groupBy('u.id')
      .addGroupBy('u."createdAt"')
      .select('u.id', 'id')
      .addSelect('COUNT(t.id)', 'load')
      .orderBy('"load"', 'ASC')
      .addOrderBy('u."createdAt"', 'ASC')
      .limit(1)
      .getRawOne<{ id: string | number; load: string | number }>();
    if (!rows) return null;
    const id = typeof rows.id === 'string' ? parseInt(rows.id, 10) : rows.id;
    return id;
  }

  async getProjectWorkload(projectId: number): Promise<WorkloadEntry[]> {
    const rows = await this.users
      .createQueryBuilder('u')
      .leftJoin(
        Ticket,
        't',
        't."assigneeId" = u.id AND t."projectId" = :projectId AND t.status <> :done AND t."deletedAt" IS NULL',
        { projectId, done: TicketStatus.DONE },
      )
      .where('u.role = :role AND u."deletedAt" IS NULL', { role: UserRole.DEVELOPER })
      .groupBy('u.id')
      .addGroupBy('u."createdAt"')
      .addGroupBy('u.username')
      .select('u.id', 'userId')
      .addSelect('u.username', 'username')
      .addSelect('COUNT(t.id)', 'openTicketCount')
      .orderBy('"openTicketCount"', 'ASC')
      .addOrderBy('u."createdAt"', 'ASC')
      .getRawMany<{ userId: string | number; username: string; openTicketCount: string | number }>();
    return rows.map((r) => ({
      userId: typeof r.userId === 'string' ? parseInt(r.userId, 10) : r.userId,
      username: r.username,
      openTicketCount:
        typeof r.openTicketCount === 'string'
          ? parseInt(r.openTicketCount, 10)
          : r.openTicketCount,
    }));
  }
}
