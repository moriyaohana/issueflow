import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'ticket_dependencies' })
@Index('UQ_ticket_dependency', ['ticketId', 'blockedBy'], { unique: true })
export class TicketDependency {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  ticketId: number;

  // DB column stays `blockerId`; only the TS field is renamed to match the
  // README DTO wording.
  @Column({ name: 'blockerId', type: 'int' })
  blockedBy: number;

  @Column({ type: 'boolean', default: false })
  deletedByCascade: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn({ name: 'deletedAt' })
  deletedAt: Date | null;
}
