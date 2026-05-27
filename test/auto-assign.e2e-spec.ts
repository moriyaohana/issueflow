import * as request from 'supertest';
import { createTestApp, TestAppContext } from './test-app.factory';
import { UserRole } from '../src/common/enums/user-role.enum';

describe('Auto-assign + Workload (e2e)', () => {
  let ctx: TestAppContext;
  let adminToken: string;
  let adminUserId: number;
  let projectId: number;
  let dev1: { id: number };
  let dev2: { id: number };
  let dev3: { id: number };

  beforeAll(async () => {
    ctx = await createTestApp();
    const admin = await ctx.obtainToken({ role: UserRole.ADMIN, username: 'admin' });
    adminToken = admin.accessToken;
    adminUserId = admin.userId;
    // Create three developers in order so the tie-break by oldest createdAt is
    // deterministic.
    const d1 = await ctx.obtainToken({ role: UserRole.DEVELOPER, username: 'd1' });
    const d2 = await ctx.obtainToken({ role: UserRole.DEVELOPER, username: 'd2' });
    const d3 = await ctx.obtainToken({ role: UserRole.DEVELOPER, username: 'd3' });
    dev1 = { id: d1.userId };
    dev2 = { id: d2.userId };
    dev3 = { id: d3.userId };

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

  it('first ticket without assigneeId goes to the oldest DEVELOPER', async () => {
    const ticket = await request(ctx.app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 't',
        description: 'd',
        status: 'TODO',
        priority: 'LOW',
        type: 'BUG',
        projectId,
      })
      .expect(200);
    expect(ticket.body.assigneeId).toBe(dev1.id);
  });

  it('second auto-assigned ticket goes to the next least-loaded developer', async () => {
    const ticket = await request(ctx.app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 't',
        description: 'd',
        status: 'TODO',
        priority: 'LOW',
        type: 'BUG',
        projectId,
      })
      .expect(200);
    // dev2 was created after dev1, dev1 already has one ticket so dev2 wins.
    expect(ticket.body.assigneeId).toBe(dev2.id);
  });

  it('workload endpoint returns all three developers sorted ascending', async () => {
    const wl = await request(ctx.app.getHttpServer())
      .get(`/projects/${projectId}/workload`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const counts = wl.body.map((e: any) => e.openTicketCount);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
    expect(wl.body.find((e: any) => e.userId === dev3.id)).toBeTruthy();
  });

  it('soft-deleted developer drops out of workload + auto-assign', async () => {
    await request(ctx.app.getHttpServer())
      .delete(`/users/${dev3.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const wl = await request(ctx.app.getHttpServer())
      .get(`/projects/${projectId}/workload`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(wl.body.find((e: any) => e.userId === dev3.id)).toBeUndefined();
  });

  it('records AUTO_ASSIGN audit row with actor=SYSTEM', async () => {
    const audit = await request(ctx.app.getHttpServer())
      .get('/audit-logs?action=AUTO_ASSIGN&actor=SYSTEM&entityType=TICKET')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(audit.body.length).toBeGreaterThan(0);
    expect(audit.body[0].performedBy).toBeNull();
  });
});
