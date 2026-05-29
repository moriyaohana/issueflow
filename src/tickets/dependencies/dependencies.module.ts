import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TicketDependency } from './entities/ticket-dependency.entity';
import { Ticket } from '../entities/ticket.entity';
import { DependenciesService } from './dependencies.service';
import { DependenciesController } from './dependencies.controller';
import { TicketsService } from '../tickets.service';
import { TicketsModule } from '../tickets.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TicketDependency, Ticket]),
    TicketsModule,
  ],
  providers: [DependenciesService],
  controllers: [DependenciesController],
  exports: [DependenciesService],
})
export class DependenciesModule implements OnModuleInit {
  constructor(
    private readonly tickets: TicketsService,
    private readonly deps: DependenciesService,
  ) {}

  onModuleInit(): void {
    this.tickets.registerBlockersResolver({
      assertBlockersResolvedForDone: (id) =>
        this.deps.assertBlockersResolvedForDone(id),
    });
    this.tickets.registerCascadeTarget({
      cascadeSoftDeleteDependencies: (ids, actorUserId) =>
        this.deps.cascadeSoftDeleteDependencies(ids, actorUserId),
      cascadeRestoreDependencies: (ids, actorUserId) =>
        this.deps.cascadeRestoreDependencies(ids, actorUserId),
    });
  }
}
