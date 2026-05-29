import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommentVersion1700000010000 implements MigrationInterface {
  name = 'AddCommentVersion1700000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "comments" ADD COLUMN "version" int NOT NULL DEFAULT 1`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "comments" DROP COLUMN "version"`);
  }
}
