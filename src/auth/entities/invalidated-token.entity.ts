import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'invalidated_tokens' })
export class InvalidatedToken {
  @PrimaryColumn({ type: 'uuid' })
  jti: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;
}
