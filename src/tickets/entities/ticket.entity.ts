import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { TicketStatus } from '../../common/enums/ticket-status.enum';
import { TicketPriority } from '../../common/enums/ticket-priority.enum';
import { TicketType } from '../../common/enums/ticket-type.enum';

@Entity({ name: 'tickets' })
export class Ticket {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: TicketStatus })
  status: TicketStatus;

  @Column({ type: 'enum', enum: TicketPriority })
  priority: TicketPriority;

  @Column({ type: 'enum', enum: TicketType })
  type: TicketType;

  @Column({ type: 'int' })
  projectId: number;

  @Column({ type: 'int', nullable: true })
  assigneeId: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  dueDate: Date | null;

  @Column({ type: 'boolean', default: false })
  isOverdue: boolean;

  // Managed by TypeORM: bumped automatically on every entity `save()`. Bulk
  // QueryBuilder UPDATEs bypass the optimistic-lock save path and must bump
  // the column manually via `version: () => 'version + 1'`.
  @VersionColumn()
  version: number;

  @Column({ type: 'boolean', default: false })
  deletedByCascade: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
