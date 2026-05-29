import * as request from 'supertest';
import { HttpStatus } from '@nestjs/common';
import { createTestApp, TestAppContext } from './test-app.factory';
import { UserRole } from '../src/common/enums/user-role.enum';

describe('Audit log (e2e)', () => {
  let ctx: TestAppContext;
  let adminToken: string;
  let adminUserId: number;

  beforeAll(async () => {
    ctx = await createTestApp();
    const admin = await ctx.obtainToken({ role: UserRole.ADMIN });
    adminToken = admin.accessToken;
    adminUserId = admin.userId;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('records CREATE on PROJECT and UPDATE on TICKET with metadata.statusFrom/statusTo', async () => {
    const project = await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'p', description: 'd', ownerId: adminUserId })
      .expect(HttpStatus.OK);

    const projectAudit = await request(ctx.app.getHttpServer())
      .get(`/audit-logs?entityType=PROJECT&entityId=${project.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(
      projectAudit.body.find((r: any) => r.action === 'CREATE'),
    ).toBeTruthy();

    const ticket = await request(ctx.app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 't',
        description: 'd',
        status: 'TODO',
        priority: 'LOW',
        type: 'BUG',
        projectId: project.body.id,
      })
      .expect(HttpStatus.OK);

    await request(ctx.app.getHttpServer())
      .patch(`/tickets/${ticket.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', ticket.headers.etag)
      .send({ status: 'IN_PROGRESS' })
      .expect(HttpStatus.OK);

    const ticketAudit = await request(ctx.app.getHttpServer())
      .get(`/audit-logs?entityType=TICKET&entityId=${ticket.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    const update = ticketAudit.body.find((r: any) => r.action === 'UPDATE');
    expect(update).toBeTruthy();
    expect(update.metadata.statusFrom).toBe('TODO');
    expect(update.metadata.statusTo).toBe('IN_PROGRESS');
  });

  it('cascading project delete writes DELETE rows on TICKET and COMMENT with metadata.cascade', async () => {
    const project = await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'c', description: 'd', ownerId: adminUserId })
      .expect(HttpStatus.OK);
    const ticket = await request(ctx.app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 't',
        description: 'd',
        status: 'TODO',
        priority: 'LOW',
        type: 'BUG',
        projectId: project.body.id,
      })
      .expect(HttpStatus.OK);
    await request(ctx.app.getHttpServer())
      .post(`/tickets/${ticket.body.id}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ authorId: adminUserId, content: 'hi' })
      .expect(HttpStatus.OK);

    await request(ctx.app.getHttpServer())
      .delete(`/projects/${project.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);

    const ticketAudit = await request(ctx.app.getHttpServer())
      .get(`/audit-logs?entityType=TICKET&entityId=${ticket.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    const cascadeRow = ticketAudit.body.find(
      (r: any) => r.action === 'DELETE' && r.metadata?.cascade === 'soft',
    );
    expect(cascadeRow).toBeTruthy();
    expect(cascadeRow.metadata.projectId).toBe(project.body.id);

    const commentAudit = await request(ctx.app.getHttpServer())
      .get(`/audit-logs?entityType=COMMENT`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(
      commentAudit.body.find(
        (r: any) => r.action === 'DELETE' && r.metadata?.cascade === 'soft',
      ),
    ).toBeTruthy();
  });

  it('records LOGIN audit row', async () => {
    const t = await ctx.obtainToken({ role: UserRole.DEVELOPER });
    const audit = await request(ctx.app.getHttpServer())
      .get(`/audit-logs?action=LOGIN&entityType=USER&entityId=${t.userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(audit.body.find((r: any) => r.action === 'LOGIN')).toBeTruthy();
  });
});
