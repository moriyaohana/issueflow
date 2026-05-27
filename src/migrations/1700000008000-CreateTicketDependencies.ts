import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTicketDependencies1700000008000 implements MigrationInterface {
  name = 'CreateTicketDependencies1700000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ticket_dependencies" (
        "id" SERIAL NOT NULL,
        "ticketId" int NOT NULL,
        "blockerId" int NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ticket_dependencies" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ticket_dependency" ON "ticket_dependencies" ("ticketId", "blockerId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_ticket_dependency"`);
    await queryRunner.query(`DROP TABLE "ticket_dependencies"`);
  }
}
