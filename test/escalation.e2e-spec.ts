import * as request from 'supertest';
import { createTestApp, TestAppContext } from './test-app.factory';
import { UserRole } from '../src/common/enums/user-role.enum';
import { EscalationService } from '../src/tickets/escalation/escalation.service';

describe('Auto-escalation (e2e)', () => {
  let ctx: TestAppContext;
  let adminToken: string;
  let adminUserId: number;
  let projectId: number;

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

  it('overdue LOW ticket gets bumped to MEDIUM and version increments', async () => {
    const due = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const created = await request(ctx.app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'overdue',
        description: 'd',
        status: 'TODO',
        priority: 'LOW',
        type: 'BUG',
        projectId,
        dueDate: due,
      })
      .expect(200);

    await ctx.app.get(EscalationService).runEscalation();

    const after = await request(ctx.app.getHttpServer())
      .get(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(after.body.priority).toBe('MEDIUM');
    expect(after.body.version).toBe(2);
  });

  it('manual priority PATCH sets autoEscalationPaused; subsequent run leaves it alone', async () => {
    const due = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const created = await request(ctx.app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'manual',
        description: 'd',
        status: 'TODO',
        priority: 'LOW',
        type: 'BUG',
        projectId,
        dueDate: due,
      })
      .expect(200);
    const patched = await request(ctx.app.getHttpServer())
      .patch(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: created.body.version, priority: 'HIGH' })
      .expect(200);
    expect(patched.body.autoEscalationPaused).toBe(true);
    expect(patched.body.isOverdue).toBe(false);

    const versionBefore = patched.body.version;
    await ctx.app.get(EscalationService).runEscalation();
    const after = await request(ctx.app.getHttpServer())
      .get(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(after.body.priority).toBe('HIGH');
    expect(after.body.version).toBe(versionBefore);
  });

  it('CRITICAL overdue ticket flips isOverdue and is then idempotent', async () => {
    const due = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const created = await request(ctx.app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'critical',
        description: 'd',
        status: 'TODO',
        priority: 'CRITICAL',
        type: 'BUG',
        projectId,
        dueDate: due,
      })
      .expect(200);

    await ctx.app.get(EscalationService).runEscalation();
    const after1 = await request(ctx.app.getHttpServer())
      .get(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(after1.body.priority).toBe('CRITICAL');
    expect(after1.body.isOverdue).toBe(true);
    expect(after1.body.version).toBe(2);

    await ctx.app.get(EscalationService).runEscalation();
    const after2 = await request(ctx.app.getHttpServer())
      .get(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(after2.body.version).toBe(2);
  });
});
