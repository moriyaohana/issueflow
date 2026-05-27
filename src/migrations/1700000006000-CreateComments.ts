import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateComments1700000006000 implements MigrationInterface {
  name = 'CreateComments1700000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "comments" (
        "id" SERIAL NOT NULL,
        "ticketId" int NOT NULL,
        "authorId" int NOT NULL,
        "content" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_comments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_comments_ticketId" ON "comments" ("ticketId")`);
    await queryRunner.query(`
      CREATE TABLE "mentions" (
        "id" SERIAL NOT NULL,
        "commentId" int NOT NULL,
        "userId" int NOT NULL,
        CONSTRAINT "PK_mentions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_mention_comment_user" ON "mentions" ("commentId", "userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_mention_comment_user"`);
    await queryRunner.query(`DROP TABLE "mentions"`);
    await queryRunner.query(`DROP INDEX "IDX_comments_ticketId"`);
    await queryRunner.query(`DROP TABLE "comments"`);
  }
}
