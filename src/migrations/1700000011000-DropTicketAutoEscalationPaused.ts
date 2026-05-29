import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropTicketAutoEscalationPaused1700000011000 implements MigrationInterface {
  name = 'DropTicketAutoEscalationPaused1700000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tickets" DROP COLUMN "autoEscalationPaused"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tickets" ADD COLUMN "autoEscalationPaused" boolean NOT NULL DEFAULT false`,
    );
  }
}
