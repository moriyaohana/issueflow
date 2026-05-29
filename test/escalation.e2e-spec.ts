import * as request from 'supertest';
import { HttpStatus } from '@nestjs/common';
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
      .expect(HttpStatus.OK);
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
      .expect(HttpStatus.OK);

    await ctx.app.get(EscalationService).runEscalation();

    const after = await request(ctx.app.getHttpServer())
      .get(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(after.body.priority).toBe('MEDIUM');
    expect(after.headers.etag).toBe('W/"2"');
  });

  // Manual priority change must clear isOverdue and leave the ticket eligible
  // for re-evaluation by the escalation cycle. The autoEscalationPaused field
  // was removed entirely; the response shape must not carry it any more.
  it('manual priority PATCH clears isOverdue and remains eligible for escalation', async () => {
    const due = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const created = await request(ctx.app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'reclassified',
        description: 'd',
        status: 'TODO',
        priority: 'LOW',
        type: 'BUG',
        projectId,
        dueDate: due,
      })
      .expect(HttpStatus.OK);

    // First escalation cycle bumps LOW → MEDIUM.
    await ctx.app.get(EscalationService).runEscalation();

    const fetched = await request(ctx.app.getHttpServer())
      .get(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(fetched.body.priority).toBe('MEDIUM');
    expect(fetched.headers.etag).toBe('W/"2"');

    // Manual priority PATCH to HIGH; isOverdue must be false and the response
    // shape must not contain autoEscalationPaused.
    const patched = await request(ctx.app.getHttpServer())
      .patch(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', fetched.headers.etag)
      .send({ priority: 'HIGH' })
      .expect(HttpStatus.OK);
    expect(patched.body.priority).toBe('HIGH');
    expect(patched.body.isOverdue).toBe(false);
    expect(patched.body).not.toHaveProperty('autoEscalationPaused');

    // Re-run escalation: the ticket is still eligible (no pause flag), so HIGH
    // gets bumped to CRITICAL by the second cycle.
    await ctx.app.get(EscalationService).runEscalation();
    const afterSecond = await request(ctx.app.getHttpServer())
      .get(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(afterSecond.body.priority).toBe('CRITICAL');
    expect(afterSecond.body).not.toHaveProperty('autoEscalationPaused');
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
      .expect(HttpStatus.OK);

    await ctx.app.get(EscalationService).runEscalation();
    const after1 = await request(ctx.app.getHttpServer())
      .get(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(after1.body.priority).toBe('CRITICAL');
    expect(after1.body.isOverdue).toBe(true);
    expect(after1.headers.etag).toBe('W/"2"');

    await ctx.app.get(EscalationService).runEscalation();
    const after2 = await request(ctx.app.getHttpServer())
      .get(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(after2.headers.etag).toBe('W/"2"');
  });
});
