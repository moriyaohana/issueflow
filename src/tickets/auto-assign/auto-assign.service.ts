import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import { User } from '../../users/entities/user.entity';
// Ticket is referenced only via leftJoin(Ticket, …) for TypeORM metadata.
import { Ticket } from '../entities/ticket.entity';
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

  // Picks the least-loaded active DEVELOPER in the project, oldest createdAt
  // wins ties. Pass `manager` from a transaction so the workload count joins
  // the same snapshot as the upcoming ticket insert.
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
    return typeof row.id === 'string' ? parseInt(row.id, 10) : row.id;
  }

  async getProjectWorkload(projectId: number): Promise<WorkloadEntry[]> {
    await this.projects.assertActive(projectId);
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
