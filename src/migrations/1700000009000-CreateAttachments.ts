import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAttachments1700000009000 implements MigrationInterface {
  name = 'CreateAttachments1700000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "attachments" (
        "id" SERIAL NOT NULL,
        "ticketId" int NOT NULL,
        "filename" varchar(255) NOT NULL,
        "contentType" varchar(100) NOT NULL,
        "sizeBytes" int NOT NULL,
        "data" bytea NOT NULL,
        "uploadedBy" int,
        "uploadedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attachments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_attachments_ticketId" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_attachments_uploadedBy" FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_attachments_ticketId" ON "attachments" ("ticketId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_attachments_ticketId"`);
    await queryRunner.query(`DROP TABLE "attachments"`);
  }
}
