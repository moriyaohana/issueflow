import * as request from 'supertest';
import { createTestApp, TestAppContext } from './test-app.factory';
import { UserRole } from '../src/common/enums/user-role.enum';

describe('Tickets Export/Import (e2e)', () => {
  let ctx: TestAppContext;
  let adminToken: string;
  let adminUserId: number;
  let projectId: number;
  let projectIdB: number;

  beforeAll(async () => {
    ctx = await createTestApp();
    const admin = await ctx.obtainToken({ role: UserRole.ADMIN });
    adminToken = admin.accessToken;
    adminUserId = admin.userId;
    const p = await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'A', description: 'd', ownerId: adminUserId })
      .expect(200);
    projectId = p.body.id;
    const p2 = await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'B', description: 'd', ownerId: adminUserId })
      .expect(200);
    projectIdB = p2.body.id;

    await request(ctx.app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'first, with comma',
        description: 'desc',
        status: 'TODO',
        priority: 'LOW',
        type: 'BUG',
        projectId,
      })
      .expect(200);
    await request(ctx.app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'second',
        description: 'desc',
        status: 'TODO',
        priority: 'HIGH',
        type: 'FEATURE',
        projectId,
      })
      .expect(200);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('export returns RFC 4180 quoted CSV with the right columns', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get(`/tickets/export?projectId=${projectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect('Content-Type', /text\/csv/);
    const body = res.text;
    expect(body.split('\n')[0]).toContain('id');
    expect(body).toContain('"first, with comma"');
    expect(body).toContain('"second"');
  });

  it('round-trip: import the exported CSV into a different project', async () => {
    const exp = await request(ctx.app.getHttpServer())
      .get(`/tickets/export?projectId=${projectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const imp = await request(ctx.app.getHttpServer())
      .post('/tickets/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('projectId', String(projectIdB))
      .attach('file', Buffer.from(exp.text), { filename: 'tickets.csv', contentType: 'text/csv' })
      .expect(200);
    expect(imp.body.created).toBe(2);
    expect(imp.body.failed).toBe(0);

    const listed = await request(ctx.app.getHttpServer())
      .get(`/tickets?projectId=${projectIdB}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(listed.body.length).toBe(2);
  });

  it('import into a soft-deleted project returns 404', async () => {
    const p = await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'gone', description: 'd', ownerId: adminUserId })
      .expect(200);
    await request(ctx.app.getHttpServer())
      .delete(`/projects/${p.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const csv = 'title,description,status,priority,type\nx,d,TODO,LOW,BUG\n';
    await request(ctx.app.getHttpServer())
      .post('/tickets/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('projectId', String(p.body.id))
      .attach('file', Buffer.from(csv), { filename: 'in.csv', contentType: 'text/csv' })
      .expect(404);
  });
});
