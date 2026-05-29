import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';

@Entity({ name: 'comments' })
export class Comment {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  ticketId: number;

  @Column({ type: 'int' })
  authorId: number;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  // Internal cascade-restore marker. Belt-and-braces: response DTOs already
  // hide it from every wire path; `@Exclude` ensures a future code path that
  // accidentally returns the raw entity (and runs through
  // `ClassSerializerInterceptor`) cannot leak the field either.
  @Exclude({ toPlainOnly: true })
  @Column({ type: 'boolean', default: false })
  deletedByCascade: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deletedAt' })
  deletedAt: Date | null;
}
