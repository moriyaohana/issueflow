import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../users/entities/user.entity';
import { Ticket } from '../entities/ticket.entity';
import { AutoAssignService } from './auto-assign.service';
import { WorkloadController } from './workload.controller';
import { TicketsModule } from '../tickets.module';
import { TicketsService } from '../tickets.service';
import { ProjectsModule } from '../../projects/projects.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Ticket]),
    TicketsModule,
    ProjectsModule,
  ],
  providers: [AutoAssignService],
  controllers: [WorkloadController],
  exports: [AutoAssignService],
})
export class AutoAssignModule implements OnModuleInit {
  constructor(
    private readonly tickets: TicketsService,
    private readonly auto: AutoAssignService,
  ) {}

  onModuleInit(): void {
    this.tickets.registerAutoAssignResolver({
      pickAssignee: (projectId) => this.auto.pickAssignee(projectId),
    });
  }
}
