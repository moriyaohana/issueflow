import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTickets1700000005000 implements MigrationInterface {
  name = 'CreateTickets1700000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "tickets_status_enum" AS ENUM('TODO','IN_PROGRESS','IN_REVIEW','DONE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "tickets_priority_enum" AS ENUM('LOW','MEDIUM','HIGH','CRITICAL')`,
    );
    await queryRunner.query(
      `CREATE TYPE "tickets_type_enum" AS ENUM('BUG','FEATURE','TECHNICAL')`,
    );
    await queryRunner.query(`
      CREATE TABLE "tickets" (
        "id" SERIAL NOT NULL,
        "title" varchar(255) NOT NULL,
        "description" text NOT NULL,
        "status" "tickets_status_enum" NOT NULL,
        "priority" "tickets_priority_enum" NOT NULL,
        "type" "tickets_type_enum" NOT NULL,
        "projectId" int NOT NULL,
        "assigneeId" int,
        "dueDate" TIMESTAMP WITH TIME ZONE,
        "isOverdue" boolean NOT NULL DEFAULT false,
        "autoEscalationPaused" boolean NOT NULL DEFAULT false,
        "version" int NOT NULL DEFAULT 1,
        "deletedByCascade" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_tickets" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tickets_projectId" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_tickets_assigneeId" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_tickets_projectId" ON "tickets" ("projectId")`);
    await queryRunner.query(`CREATE INDEX "IDX_tickets_assigneeId" ON "tickets" ("assigneeId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_tickets_assigneeId"`);
    await queryRunner.query(`DROP INDEX "IDX_tickets_projectId"`);
    await queryRunner.query(`DROP TABLE "tickets"`);
    await queryRunner.query(`DROP TYPE "tickets_type_enum"`);
    await queryRunner.query(`DROP TYPE "tickets_priority_enum"`);
    await queryRunner.query(`DROP TYPE "tickets_status_enum"`);
  }
}
