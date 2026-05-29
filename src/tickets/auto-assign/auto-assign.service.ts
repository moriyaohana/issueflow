import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Ticket } from '../entities/ticket.entity';
// `Ticket` is referenced via `leftJoin(Ticket, …)` only — TypeORM needs the
// entity class for metadata, but TypeScript can't see that usage.
import { UserRole } from '../../common/enums/user-role.enum';
import { TicketStatus } from '../../common/enums/ticket-status.enum';
import { ProjectsService } from '../../projects/projects.service';

export interface WorkloadEntry {
  userId: number;
  username: string;
  openTicketCount: number;
}

@Injectable()
export class AutoAssignService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * Picks the least-loaded active DEVELOPER in the project. Tie-break is the
   * oldest `createdAt`. Returns `null` when no developer is available.
   *
   * Workload = count of non-DONE, non-deleted tickets assigned to the user
   * inside that project. Admins are excluded because the role is
   * intentionally separate from delivery work.
   *
   * When called from inside a transaction (typically from
   * `TicketsService.create`), the caller passes an `EntityManager` so the
   * workload count is read against the same snapshot the upcoming ticket
   * insert commits against — two concurrent POSTs in the same project can't
   * race to pick the same developer.
   */
  async pickAssignee(
    projectId: number,
    manager?: EntityManager,
  ): Promise<number | null> {
    const qb = this.workloadQuery(projectId, manager)
      .select('u.id', 'id')
      .addSelect('CAST(COUNT(t.id) AS INTEGER)', 'load')
      .orderBy('"load"', 'ASC')
      .addOrderBy('u."createdAt"', 'ASC')
      .limit(1);
    const row = await qb.getRawOne<{ id: number | string; load: number }>();
    if (!row) return null;
    // Defensive: pg returns `int` as JS number, but some drivers / mocked
    // values (and historic test fixtures) still hand back strings.
    return typeof row.id === 'string' ? parseInt(row.id, 10) : row.id;
  }

  async getProjectWorkload(projectId: number): Promise<WorkloadEntry[]> {
    const active = await this.projects.existsAndActive(projectId);
    if (!active) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    const rows = await this.workloadQuery(projectId)
      .addGroupBy('u.username')
      .select('u.id', 'userId')
      .addSelect('u.username', 'username')
      .addSelect('CAST(COUNT(t.id) AS INTEGER)', 'openTicketCount')
      .orderBy('"openTicketCount"', 'ASC')
      .addOrderBy('u."createdAt"', 'ASC')
      .getRawMany<{
        userId: string | number;
        username: string;
        openTicketCount: string | number;
      }>();
    return rows.map((row) => ({
      userId:
        typeof row.userId === 'string' ? parseInt(row.userId, 10) : row.userId,
      username: row.username,
      openTicketCount:
        typeof row.openTicketCount === 'string'
          ? parseInt(row.openTicketCount, 10)
          : row.openTicketCount,
    }));
  }

  /**
   * Shared base of the workload aggregation: join users → assigned-and-live
   * tickets per project, filter to active developers, group by user
   * id/createdAt. Both `pickAssignee` (limit 1) and `getProjectWorkload`
   * (full list with username) tack their projections / ordering on top.
   *
   * When `manager` is provided we route the query through its `User`
   * repository so the read participates in the caller's transaction.
   */
  private workloadQuery(
    projectId: number,
    manager?: EntityManager,
  ): SelectQueryBuilder<User> {
    const usersRepo = manager ? manager.getRepository(User) : this.users;
    return usersRepo
      .createQueryBuilder('u')
      .leftJoin(
        Ticket,
        't',
        't."assigneeId" = u.id AND t."projectId" = :projectId AND t.status <> :done AND t."deletedAt" IS NULL',
        { projectId, done: TicketStatus.DONE },
      )
      .where('u.role = :role AND u."deletedAt" IS NULL', {
        role: UserRole.DEVELOPER,
      })
      .groupBy('u.id')
      .addGroupBy('u."createdAt"');
  }
}
