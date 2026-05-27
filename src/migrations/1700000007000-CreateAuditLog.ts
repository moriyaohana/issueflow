import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLog1700000007000 implements MigrationInterface {
  name = 'CreateAuditLog1700000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "audit_logs_action_enum" AS ENUM(
        'USER_CREATE','USER_UPDATE','USER_DELETE','USER_RESTORE',
        'LOGIN','LOGOUT',
        'PROJECT_CREATE','PROJECT_UPDATE','PROJECT_DELETE','PROJECT_RESTORE',
        'TICKET_CREATE','TICKET_UPDATE','TICKET_DELETE','TICKET_RESTORE',
        'TICKET_IMPORT','TICKET_EXPORT',
        'COMMENT_CREATE','COMMENT_UPDATE','COMMENT_DELETE',
        'DEPENDENCY_ADD','DEPENDENCY_REMOVE',
        'ATTACHMENT_UPLOAD','ATTACHMENT_DELETE',
        'AUTO_ASSIGN','AUTO_ESCALATE'
      )
    `);
    await queryRunner.query(
      `CREATE TYPE "audit_logs_entityType_enum" AS ENUM('USER','PROJECT','TICKET','COMMENT','ATTACHMENT','DEPENDENCY')`,
    );
    await queryRunner.query(`CREATE TYPE "audit_logs_actor_enum" AS ENUM('USER','SYSTEM')`);
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" SERIAL NOT NULL,
        "action" "audit_logs_action_enum" NOT NULL,
        "entityType" "audit_logs_entityType_enum" NOT NULL,
        "entityId" int NOT NULL,
        "performedBy" int,
        "actor" "audit_logs_actor_enum" NOT NULL,
        "metadata" jsonb,
        "timestamp" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_entity" ON "audit_logs" ("entityType", "entityId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_audit_entity"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TYPE "audit_logs_actor_enum"`);
    await queryRunner.query(`DROP TYPE "audit_logs_entityType_enum"`);
    await queryRunner.query(`DROP TYPE "audit_logs_action_enum"`);
  }
}
