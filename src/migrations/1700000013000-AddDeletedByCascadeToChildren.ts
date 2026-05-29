import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeletedByCascadeToChildren1700000013000 implements MigrationInterface {
  name = 'AddDeletedByCascadeToChildren1700000013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "comments" ADD COLUMN "deletedByCascade" BOOLEAN NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" ADD COLUMN "deletedByCascade" BOOLEAN NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_dependencies" ADD COLUMN "deletedByCascade" BOOLEAN NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ticket_dependencies" DROP COLUMN "deletedByCascade"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" DROP COLUMN "deletedByCascade"`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" DROP COLUMN "deletedByCascade"`,
    );
  }
}
