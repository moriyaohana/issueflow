import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, Repository } from 'typeorm';
import { InvalidatedToken } from './entities/invalidated-token.entity';

@Injectable()
export class InvalidatedTokensService {
  private readonly logger = new Logger(InvalidatedTokensService.name);

  constructor(
    @InjectRepository(InvalidatedToken)
    private readonly repo: Repository<InvalidatedToken>,
  ) {}

  async add(jti: string, expiresAt: Date): Promise<void> {
    await this.repo.upsert({ jti, expiresAt }, ['jti']);
  }

  async has(jti: string): Promise<boolean> {
    const found = await this.repo.findOne({
      where: { jti, expiresAt: MoreThan(new Date()) },
    });
    return !!found;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sweepExpired(): Promise<void> {
    try {
      const result = await this.repo.delete({
        expiresAt: LessThan(new Date()),
      });
      const count = result.affected ?? 0;
      if (count > 0) {
        this.logger.log(`Deny-list sweep: removed ${count} expired token(s)`);
      }
    } catch (err) {
      this.logger.error(
        `Deny-list sweep failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
