import { Entity, Index, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'mentions' })
@Index('UQ_mention_comment_user', ['commentId', 'userId'], { unique: true })
export class Mention {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  commentId: number;

  @Column({ type: 'int' })
  userId: number;
}
