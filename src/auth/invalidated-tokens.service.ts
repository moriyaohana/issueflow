import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvalidatedToken } from './entities/invalidated-token.entity';

@Injectable()
export class InvalidatedTokensService {
  constructor(
    @InjectRepository(InvalidatedToken)
    private readonly repo: Repository<InvalidatedToken>,
  ) {}

  async add(jti: string, expiresAt: Date): Promise<void> {
    await this.repo.upsert({ jti, expiresAt }, ['jti']);
  }

  async has(jti: string): Promise<boolean> {
    const found = await this.repo.findOne({ where: { jti } });
    return !!found;
  }
}
