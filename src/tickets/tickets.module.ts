import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from './entities/ticket.entity';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/users.module';
import { ProjectsService } from '../projects/projects.service';
import { TicketsExportService } from './import-export/tickets-export.service';
import { TicketsImportService } from './import-export/tickets-import.service';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket]), ProjectsModule, UsersModule],
  providers: [TicketsService, TicketsExportService, TicketsImportService],
  controllers: [TicketsController],
  exports: [TicketsService],
})
export class TicketsModule implements OnModuleInit {
  constructor(
    private readonly projects: ProjectsService,
    private readonly tickets: TicketsService,
  ) {}

  onModuleInit(): void {
    this.projects.setCascadeHandler({
      cascadeSoftDeleteForProject: (id, actor) =>
        this.tickets.cascadeSoftDeleteForProject(id, actor),
      cascadeRestoreForProject: (id, actor) => this.tickets.cascadeRestoreForProject(id, actor),
    });
  }
}
