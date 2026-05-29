import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSoftDeleteToCascadeChildren1700000012000 implements MigrationInterface {
  name = 'AddSoftDeleteToCascadeChildren1700000012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "comments" ADD COLUMN "deletedAt" TIMESTAMP WITH TIME ZONE NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" ADD COLUMN "deletedAt" TIMESTAMP WITH TIME ZONE NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_dependencies" ADD COLUMN "deletedAt" TIMESTAMP WITH TIME ZONE NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tickets" ADD COLUMN "deletedByCascade" BOOLEAN NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tickets" DROP COLUMN "deletedByCascade"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_dependencies" DROP COLUMN "deletedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" DROP COLUMN "deletedAt"`,
    );
    await queryRunner.query(`ALTER TABLE "comments" DROP COLUMN "deletedAt"`);
  }
}
