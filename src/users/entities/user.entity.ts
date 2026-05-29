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
import { UserRole } from '../../common/enums/user-role.enum';

@Entity({ name: 'users' })
@Index('UQ_users_username', ['username'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('UQ_users_email', ['email'], { unique: true, where: '"deletedAt" IS NULL' })
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  username: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  fullName: string;

  @Column({ type: 'enum', enum: UserRole })
  role: UserRole;

  // Defense-in-depth: `select: false` keeps the hash out of every find/QB
  // result by default (even raw `repo.find()` paths that bypass
  // `ClassSerializerInterceptor`). Any caller that legitimately needs it —
  // i.e. `AuthService.login` — must opt-in via an explicit `select` /
  // `addSelect('passwordHash')`. `@Exclude` is left in place as belt-and-
  // braces for code paths that do project the column and then serialize.
  @Exclude({ toPlainOnly: true })
  @Column({ type: 'varchar', length: 255, name: 'passwordHash', select: false })
  passwordHash: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;
}
