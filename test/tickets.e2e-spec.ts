import * as request from 'supertest';
import { HttpStatus } from '@nestjs/common';
import { createTestApp, TestAppContext } from './test-app.factory';
import { UserRole } from '../src/common/enums/user-role.enum';

describe('Tickets (e2e)', () => {
  let ctx: TestAppContext;
  let adminToken: string;
  let adminUserId: number;
  let projectId: number;

  beforeAll(async () => {
    ctx = await createTestApp();
    const admin = await ctx.obtainToken({ role: UserRole.ADMIN });
    adminToken = admin.accessToken;
    adminUserId = admin.userId;
    const project = await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'P', description: 'D', ownerId: adminUserId })
      .expect(200);
    projectId = project.body.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  function createTicket(payload: Partial<Record<string, any>> = {}) {
    return request(ctx.app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 't',
        description: 'd',
        status: 'TODO',
        priority: 'LOW',
        type: 'BUG',
        projectId,
        ...payload,
      });
  }

  it('create → fetch → update → 412 on stale If-Match', async () => {
    const created = await createTicket().expect(HttpStatus.OK);
    expect(created.headers.etag).toBe('W/"1"');
    expect(created.body.version).toBeUndefined();
    const id = created.body.id;

    const fetched = await request(ctx.app.getHttpServer())
      .get(`/tickets/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(fetched.headers.etag).toBe('W/"1"');
    expect(fetched.body.version).toBeUndefined();
    expect(fetched.body).toHaveProperty('isOverdue', false);
    expect(fetched.body).toHaveProperty('dueDate');

    const updated = await request(ctx.app.getHttpServer())
      .patch(`/tickets/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', 'W/"1"')
      .send({ status: 'IN_PROGRESS' })
      .expect(HttpStatus.OK);
    expect(updated.headers.etag).toBe('W/"2"');
    expect(updated.body.version).toBeUndefined();
    expect(updated.body.status).toBe('IN_PROGRESS');

    await request(ctx.app.getHttpServer())
      .patch(`/tickets/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', 'W/"1"')
      .send({ status: 'IN_REVIEW' })
      .expect(HttpStatus.PRECONDITION_FAILED);
  });

  it('PATCH without If-Match returns 428 Precondition Required', async () => {
    const created = await createTicket().expect(HttpStatus.OK);
    await request(ctx.app.getHttpServer())
      .patch(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(HttpStatus.PRECONDITION_REQUIRED);
  });

  it('DELETE without If-Match returns 428; with stale 412; with current succeeds', async () => {
    const created = await createTicket().expect(HttpStatus.OK);
    const id = created.body.id;

    await request(ctx.app.getHttpServer())
      .delete(`/tickets/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.PRECONDITION_REQUIRED);

    await request(ctx.app.getHttpServer())
      .delete(`/tickets/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', 'W/"99"')
      .expect(HttpStatus.PRECONDITION_FAILED);

    await request(ctx.app.getHttpServer())
      .delete(`/tickets/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', 'W/"1"')
      .expect(HttpStatus.OK);
  });

  it('rejects backward status transition with 400', async () => {
    const created = await createTicket({ status: 'IN_REVIEW' }).expect(
      HttpStatus.OK,
    );
    await request(ctx.app.getHttpServer())
      .patch(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', 'W/"1"')
      .send({ status: 'TODO' })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('DONE ticket is immutable (403)', async () => {
    const created = await createTicket({ status: 'IN_REVIEW' }).expect(
      HttpStatus.OK,
    );
    const moved = await request(ctx.app.getHttpServer())
      .patch(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', 'W/"1"')
      .send({ status: 'DONE' })
      .expect(HttpStatus.OK);
    expect(moved.body.status).toBe('DONE');
    expect(moved.headers.etag).toBe('W/"2"');
    await request(ctx.app.getHttpServer())
      .patch(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', moved.headers.etag)
      .send({ title: 'new title' })
      .expect(HttpStatus.FORBIDDEN);
  });

  it('rejects assigneeId pointing to a soft-deleted user with 400', async () => {
    const orphan = await ctx.obtainToken({ role: UserRole.DEVELOPER });
    await request(ctx.app.getHttpServer())
      .delete(`/users/${orphan.userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await createTicket({ assigneeId: orphan.userId }).expect(400);
  });

  it('soft-delete → list-deleted → restore lifecycle', async () => {
    const created = await createTicket().expect(HttpStatus.OK);
    const id = created.body.id;

    await request(ctx.app.getHttpServer())
      .delete(`/tickets/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', created.headers.etag)
      .expect(HttpStatus.OK);

    const liveList = await request(ctx.app.getHttpServer())
      .get(`/tickets?projectId=${projectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(liveList.body.find((t: any) => t.id === id)).toBeUndefined();

    const deleted = await request(ctx.app.getHttpServer())
      .get(`/tickets/deleted?projectId=${projectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(deleted.body.find((t: any) => t.id === id)).toBeTruthy();

    await request(ctx.app.getHttpServer())
      .post(`/tickets/${id}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const live2 = await request(ctx.app.getHttpServer())
      .get(`/tickets?projectId=${projectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(live2.body.find((t: any) => t.id === id)).toBeTruthy();
  });

  it('cascading project soft-delete: tickets marked deletedByCascade and restored together', async () => {
    const pj = await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'cascade', description: 'd', ownerId: adminUserId })
      .expect(200);
    const cascadeProjectId = pj.body.id;

    const t1 = await request(ctx.app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'A',
        description: 'd',
        status: 'TODO',
        priority: 'LOW',
        type: 'BUG',
        projectId: cascadeProjectId,
      })
      .expect(200);
    const t2 = await request(ctx.app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'B',
        description: 'd',
        status: 'TODO',
        priority: 'LOW',
        type: 'BUG',
        projectId: cascadeProjectId,
      })
      .expect(200);

    await request(ctx.app.getHttpServer())
      .delete(`/projects/${cascadeProjectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const deletedList = await request(ctx.app.getHttpServer())
      .get(`/tickets/deleted?projectId=${cascadeProjectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const items = deletedList.body.filter((t: any) =>
      [t1.body.id, t2.body.id].includes(t.id),
    );
    expect(items.length).toBe(2);
    expect(items.every((t: any) => t.deletedByCascade === true)).toBe(true);

    await request(ctx.app.getHttpServer())
      .post(`/projects/${cascadeProjectId}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const liveList = await request(ctx.app.getHttpServer())
      .get(`/tickets?projectId=${cascadeProjectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      liveList.body.filter((t: any) => [t1.body.id, t2.body.id].includes(t.id))
        .length,
    ).toBe(2);
    expect(liveList.body.every((t: any) => t.deletedByCascade === false)).toBe(
      true,
    );
  });
});
