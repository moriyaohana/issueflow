import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInvalidatedTokens1700000003000 implements MigrationInterface {
  name = 'CreateInvalidatedTokens1700000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "invalidated_tokens" (
        "jti" uuid NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_invalidated_tokens" PRIMARY KEY ("jti")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "invalidated_tokens"`);
  }
}
