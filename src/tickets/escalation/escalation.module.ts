import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from '../entities/ticket.entity';
import { EscalationService } from './escalation.service';
import { EscalationCron } from './escalation.cron';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket])],
  providers: [EscalationService, EscalationCron],
  exports: [EscalationService],
})
export class EscalationModule {}
