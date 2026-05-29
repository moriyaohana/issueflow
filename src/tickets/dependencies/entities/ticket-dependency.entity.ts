import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'ticket_dependencies' })
// Index keys are TS-level property names. The underlying DB column stays
// `blockerId` (see `@Column({ name: 'blockerId' })` below and the migration);
// only the entity-level identifier was renamed to match the README/PDF DTO
// wording (`blockedBy`). No schema change.
@Index('UQ_ticket_dependency', ['ticketId', 'blockedBy'], { unique: true })
export class TicketDependency {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  ticketId: number;

  // The README and DTO speak of the "blocked by" side of a dependency, but the
  // original schema column was named `blockerId`. We rename only at the TS
  // layer (via `name: 'blockerId'`) so the entity field matches the DTO field
  // and the silent translation layer in the controller can go away.
  @Column({ name: 'blockerId', type: 'int' })
  blockedBy: number;

  @Column({ type: 'boolean', default: false })
  deletedByCascade: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn({ name: 'deletedAt' })
  deletedAt: Date | null;
}
