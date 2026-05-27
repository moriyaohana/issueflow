import * as request from 'supertest';
import { createTestApp, TestAppContext } from './test-app.factory';
import { UserRole } from '../src/common/enums/user-role.enum';

describe('Attachments (e2e)', () => {
  let ctx: TestAppContext;
  let adminToken: string;
  let adminUserId: number;
  let ticketId: number;

  beforeAll(async () => {
    ctx = await createTestApp();
    const admin = await ctx.obtainToken({ role: UserRole.ADMIN });
    adminToken = admin.accessToken;
    adminUserId = admin.userId;
    const project = await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'p', description: 'd', ownerId: adminUserId })
      .expect(200);
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
      .expect(200);
    ticketId = ticket.body.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('upload PNG → returns metadata; delete → 200; delete again → 404', async () => {
    const upload = await request(ctx.app.getHttpServer())
      .post(`/tickets/${ticketId}/attachments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        filename: 'screenshot.png',
        contentType: 'image/png',
      })
      .expect(200);
    expect(upload.body).toEqual({
      id: expect.any(Number),
      ticketId,
      filename: 'screenshot.png',
      contentType: 'image/png',
    });
    expect(upload.body).not.toHaveProperty('data');

    await request(ctx.app.getHttpServer())
      .delete(`/tickets/${ticketId}/attachments/${upload.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(ctx.app.getHttpServer())
      .delete(`/tickets/${ticketId}/attachments/${upload.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('rejects an executable mime type with 400', async () => {
    await request(ctx.app.getHttpServer())
      .post(`/tickets/${ticketId}/attachments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from([0]), {
        filename: 'bad.exe',
        contentType: 'application/x-msdownload',
      })
      .expect(400);
  });

  it('cascading hard-delete on ticket soft-delete: deleting the ticket purges its attachments', async () => {
    const project = await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'pp', description: 'd', ownerId: adminUserId })
      .expect(200);
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
      .expect(200);
    const upload = await request(ctx.app.getHttpServer())
      .post(`/tickets/${ticket.body.id}/attachments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' })
      .expect(200);
    await request(ctx.app.getHttpServer())
      .delete(`/tickets/${ticket.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const audit = await request(ctx.app.getHttpServer())
      .get(
        `/audit-logs?entityType=ATTACHMENT&entityId=${upload.body.id}&action=ATTACHMENT_DELETE`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(audit.body.find((r: any) => r.metadata?.cascade === true)).toBeTruthy();
  });
});
