import {
  Column,
  CreateDateColumn,
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

  @Column({ type: 'int' })
  uploadedBy: number;

  @CreateDateColumn()
  uploadedAt: Date;
}
