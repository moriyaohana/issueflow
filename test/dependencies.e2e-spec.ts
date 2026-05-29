import * as request from 'supertest';
import { createTestApp, TestAppContext } from './test-app.factory';
import { UserRole } from '../src/common/enums/user-role.enum';

describe('Ticket Dependencies (e2e)', () => {
  let ctx: TestAppContext;
  let adminToken: string;
  let adminUserId: number;
  let projectId: number;

  async function makeTicket(p = projectId, status = 'TODO') {
    const r = await request(ctx.app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 't',
        description: 'd',
        status,
        priority: 'LOW',
        type: 'BUG',
        projectId: p,
      })
      .expect(200);
    return { ...r.body, etag: r.headers.etag as string };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    const admin = await ctx.obtainToken({ role: UserRole.ADMIN });
    adminToken = admin.accessToken;
    adminUserId = admin.userId;
    const p = await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'p', description: 'd', ownerId: adminUserId })
      .expect(200);
    projectId = p.body.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('happy path: add → list → remove', async () => {
    const a = await makeTicket();
    const b = await makeTicket();
    await request(ctx.app.getHttpServer())
      .post(`/tickets/${a.id}/dependencies`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ blockedBy: b.id })
      .expect(200);
    const list = await request(ctx.app.getHttpServer())
      .get(`/tickets/${a.id}/dependencies`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.find((d: any) => d.id === b.id)).toBeTruthy();
    await request(ctx.app.getHttpServer())
      .delete(`/tickets/${a.id}/dependencies/${b.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const list2 = await request(ctx.app.getHttpServer())
      .get(`/tickets/${a.id}/dependencies`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(list2.body).toEqual([]);
  });

  it('rejects self-dependency, duplicate, cross-project, and DONE transition with unresolved blocker', async () => {
    const a = await makeTicket();
    const b = await makeTicket();

    await request(ctx.app.getHttpServer())
      .post(`/tickets/${a.id}/dependencies`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ blockedBy: a.id })
      .expect(400);

    await request(ctx.app.getHttpServer())
      .post(`/tickets/${a.id}/dependencies`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ blockedBy: b.id })
      .expect(200);
    await request(ctx.app.getHttpServer())
      .post(`/tickets/${a.id}/dependencies`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ blockedBy: b.id })
      .expect(409);

    const otherProject = await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'other', description: 'x', ownerId: adminUserId })
      .expect(200);
    const c = await makeTicket(otherProject.body.id);
    await request(ctx.app.getHttpServer())
      .post(`/tickets/${a.id}/dependencies`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ blockedBy: c.id })
      .expect(400);

    // Move ticket 'a' to IN_REVIEW so we can attempt DONE transition.
    const reviewing = await request(ctx.app.getHttpServer())
      .patch(`/tickets/${a.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', a.etag)
      .send({ status: 'IN_REVIEW' })
      .expect(200);

    // Blocker 'b' is still TODO; transitioning 'a' to DONE should be blocked.
    await request(ctx.app.getHttpServer())
      .patch(`/tickets/${a.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', reviewing.headers.etag)
      .send({ status: 'DONE' })
      .expect(409);

    // Move blocker through IN_REVIEW → DONE then 'a' should be allowed to DONE.
    const bUpdated1 = await request(ctx.app.getHttpServer())
      .patch(`/tickets/${b.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', b.etag)
      .send({ status: 'IN_REVIEW' })
      .expect(200);
    await request(ctx.app.getHttpServer())
      .patch(`/tickets/${b.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', bUpdated1.headers.etag)
      .send({ status: 'DONE' })
      .expect(200);
    await request(ctx.app.getHttpServer())
      .patch(`/tickets/${a.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', reviewing.headers.etag)
      .send({ status: 'DONE' })
      .expect(200);
  });

  it('soft-deleted ticket rejects add with 404', async () => {
    const a = await makeTicket();
    await request(ctx.app.getHttpServer())
      .delete(`/tickets/${a.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', a.etag)
      .expect(200);
    const b = await makeTicket();
    await request(ctx.app.getHttpServer())
      .post(`/tickets/${a.id}/dependencies`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ blockedBy: b.id })
      .expect(404);
  });
});
