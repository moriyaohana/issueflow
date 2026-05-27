import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjects1700000004000 implements MigrationInterface {
  name = 'CreateProjects1700000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id" SERIAL NOT NULL,
        "name" varchar(255) NOT NULL,
        "description" text NOT NULL,
        "ownerId" int NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_projects" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "projects"`);
  }
}
