import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from './entities/ticket.entity';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/users.module';
import { ProjectsService } from '../projects/projects.service';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket]), ProjectsModule, UsersModule],
  providers: [TicketsService],
  controllers: [TicketsController],
  exports: [TicketsService],
})
export class TicketsModule implements OnModuleInit {
  constructor(
    private readonly projects: ProjectsService,
    private readonly tickets: TicketsService,
  ) {}

  // Wire the project → ticket cascade once both services are constructed.
  onModuleInit(): void {
    this.projects.setCascadeHandler({
      cascadeSoftDeleteForProject: (id) => this.tickets.cascadeSoftDeleteForProject(id),
      cascadeRestoreForProject: (id) => this.tickets.cascadeRestoreForProject(id),
    });
  }
}
