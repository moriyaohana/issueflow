import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'ticket_dependencies' })
@Index('UQ_ticket_dependency', ['ticketId', 'blockerId'], { unique: true })
export class TicketDependency {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  ticketId: number;

  @Column({ type: 'int' })
  blockerId: number;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn({ name: 'deletedAt' })
  deletedAt: Date | null;
}
