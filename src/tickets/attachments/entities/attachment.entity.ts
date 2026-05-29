import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'attachments' })
export class Attachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  ticketId: number;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ type: 'varchar', length: 100 })
  contentType: string;

  @Column({ type: 'int' })
  sizeBytes: number;

  @Column({ type: 'bytea' })
  data: Buffer;

  // Nullable to align with the `ON DELETE SET NULL` FK to `users.id`.
  // In practice users are soft-deleted only, so this stays populated; the
  // null path exists as a safety valve for a future hard-delete.
  @Column({ type: 'int', nullable: true })
  uploadedBy: number | null;

  @Column({ type: 'boolean', default: false })
  deletedByCascade: boolean;

  @CreateDateColumn()
  uploadedAt: Date;

  @DeleteDateColumn({ name: 'deletedAt' })
  deletedAt: Date | null;
}
