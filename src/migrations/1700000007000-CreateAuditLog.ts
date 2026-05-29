import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLog1700000007000 implements MigrationInterface {
  name = 'CreateAuditLog1700000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "audit_logs_action_enum" AS ENUM(
        'CREATE','UPDATE','DELETE','RESTORE',
        'AUTO_ASSIGN','AUTO_ESCALATE',
        'LOGIN','LOGIN_FAILED'
      )
    `);
    await queryRunner.query(
      `CREATE TYPE "audit_logs_entityType_enum" AS ENUM('USER','PROJECT','TICKET','COMMENT','ATTACHMENT','DEPENDENCY')`,
    );
    await queryRunner.query(
      `CREATE TYPE "audit_logs_actor_enum" AS ENUM('USER','SYSTEM')`,
    );
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
