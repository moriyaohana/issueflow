import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EscalationService } from './escalation.service';

@Injectable()
export class EscalationCron {
  private readonly logger = new Logger(EscalationCron.name);

  constructor(private readonly escalation: EscalationService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handle(): Promise<void> {
    try {
      const affected = await this.escalation.runEscalation();
      this.logger.log(`Escalation tick: ${affected} ticket(s) updated`);
    } catch (err) {
      this.logger.error(
        `Escalation tick failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
