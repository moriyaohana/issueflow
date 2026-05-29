import * as request from 'supertest';
import { HttpStatus } from '@nestjs/common';
import { createTestApp, TestAppContext } from './test-app.factory';
import { UserRole } from '../src/common/enums/user-role.enum';

describe('Comments + Mentions (e2e)', () => {
  let ctx: TestAppContext;
  let adminToken: string;
  let adminUserId: number;
  let alice: { id: number };
  let bob: { id: number };
  let carol: { id: number };
  let projectId: number;
  let ticketId: number;

  beforeAll(async () => {
    ctx = await createTestApp();
    const admin = await ctx.obtainToken({ role: UserRole.ADMIN });
    adminToken = admin.accessToken;
    adminUserId = admin.userId;

    const a = await ctx.obtainToken({
      role: UserRole.DEVELOPER,
      username: 'alice',
    });
    const b = await ctx.obtainToken({
      role: UserRole.DEVELOPER,
      username: 'bob',
    });
    const c = await ctx.obtainToken({
      role: UserRole.DEVELOPER,
      username: 'carol',
    });
    alice = { id: a.userId };
    bob = { id: b.userId };
    carol = { id: c.userId };

    const project = await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'P', description: 'D', ownerId: adminUserId })
      .expect(HttpStatus.OK);
    projectId = project.body.id;
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
      .expect(HttpStatus.OK);
    ticketId = ticket.body.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('create comment with @mentions; update rewrites mention set', async () => {
    const create = await request(ctx.app.getHttpServer())
      .post(`/tickets/${ticketId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ authorId: adminUserId, content: 'Hello @alice and @bob' })
      .expect(HttpStatus.OK);
    expect(create.headers.etag).toBe('W/"1"');
    expect(create.body.version).toBeUndefined();
    expect(
      create.body.mentionedUsers.map((u: any) => u.username).sort(),
    ).toEqual(['alice', 'bob']);
    const commentId = create.body.id;

    const update = await request(ctx.app.getHttpServer())
      .patch(`/tickets/${ticketId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', 'W/"1"')
      .send({ content: 'Now mentioning @carol only' })
      .expect(HttpStatus.OK);
    expect(update.headers.etag).toBe('W/"2"');
    expect(update.body.version).toBeUndefined();
    expect(update.body.mentionedUsers.map((u: any) => u.username)).toEqual([
      'carol',
    ]);

    const aliceMentions = await request(ctx.app.getHttpServer())
      .get(`/users/${alice.id}/mentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(
      aliceMentions.body.data.find((c: any) => c.id === commentId),
    ).toBeUndefined();

    const carolMentions = await request(ctx.app.getHttpServer())
      .get(`/users/${carol.id}/mentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(
      carolMentions.body.data.find((c: any) => c.id === commentId),
    ).toBeTruthy();
  });

  it('unknown @mention is silently dropped', async () => {
    const create = await request(ctx.app.getHttpServer())
      .post(`/tickets/${ticketId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ authorId: adminUserId, content: 'hi @ghost' })
      .expect(HttpStatus.OK);
    expect(create.body.mentionedUsers).toEqual([]);
  });

  it('soft-deleted user mention is silently dropped', async () => {
    const tmp = await ctx.obtainToken({
      role: UserRole.DEVELOPER,
      username: 'dave',
    });
    await request(ctx.app.getHttpServer())
      .delete(`/users/${tmp.userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    const create = await request(ctx.app.getHttpServer())
      .post(`/tickets/${ticketId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ authorId: adminUserId, content: 'hi @dave' })
      .expect(HttpStatus.OK);
    expect(create.body.mentionedUsers).toEqual([]);
  });

  it('PATCH without If-Match returns 428; with stale 412; with current succeeds', async () => {
    const create = await request(ctx.app.getHttpServer())
      .post(`/tickets/${ticketId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ authorId: adminUserId, content: 'first' })
      .expect(HttpStatus.OK);
    expect(create.headers.etag).toBe('W/"1"');
    const commentId = create.body.id;

    await request(ctx.app.getHttpServer())
      .patch(`/tickets/${ticketId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: 'no header' })
      .expect(HttpStatus.PRECONDITION_REQUIRED);

    await request(ctx.app.getHttpServer())
      .patch(`/tickets/${ticketId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', 'W/"99"')
      .send({ content: 'stale' })
      .expect(HttpStatus.PRECONDITION_FAILED);

    const ok = await request(ctx.app.getHttpServer())
      .patch(`/tickets/${ticketId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', 'W/"1"')
      .send({ content: 'current' })
      .expect(HttpStatus.OK);
    expect(ok.headers.etag).toBe('W/"2"');
  });

  it('DELETE without If-Match returns 428; with stale 412; with current succeeds', async () => {
    const create = await request(ctx.app.getHttpServer())
      .post(`/tickets/${ticketId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ authorId: adminUserId, content: 'to-delete' })
      .expect(HttpStatus.OK);
    const commentId = create.body.id;

    await request(ctx.app.getHttpServer())
      .delete(`/tickets/${ticketId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.PRECONDITION_REQUIRED);

    await request(ctx.app.getHttpServer())
      .delete(`/tickets/${ticketId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', 'W/"99"')
      .expect(HttpStatus.PRECONDITION_FAILED);

    await request(ctx.app.getHttpServer())
      .delete(`/tickets/${ticketId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', 'W/"1"')
      .expect(HttpStatus.OK);
  });

  it('case-insensitive matching: @ALICE matches alice', async () => {
    const create = await request(ctx.app.getHttpServer())
      .post(`/tickets/${ticketId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ authorId: adminUserId, content: 'shoutout @ALICE' })
      .expect(HttpStatus.OK);
    expect(create.body.mentionedUsers.map((u: any) => u.username)).toEqual([
      'alice',
    ]);
  });

  it('cascade: soft-delete the ticket → comments soft-gone; restore brings them back', async () => {
    const tk = await request(ctx.app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'c',
        description: 'd',
        status: 'TODO',
        priority: 'LOW',
        type: 'BUG',
        projectId,
      })
      .expect(HttpStatus.OK);
    const tid = tk.body.id;
    await request(ctx.app.getHttpServer())
      .post(`/tickets/${tid}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ authorId: adminUserId, content: 'sticky @alice' })
      .expect(HttpStatus.OK);
    await request(ctx.app.getHttpServer())
      .delete(`/tickets/${tid}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', tk.headers.etag)
      .expect(HttpStatus.OK);
    await request(ctx.app.getHttpServer())
      .get(`/tickets/${tid}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.NOT_FOUND);
    await request(ctx.app.getHttpServer())
      .post(`/tickets/${tid}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    const list = await request(ctx.app.getHttpServer())
      .get(`/tickets/${tid}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].content).toBe('sticky @alice');
  });

  it('refusing to comment when author is soft-deleted (404)', async () => {
    const ghost = await ctx.obtainToken({
      role: UserRole.DEVELOPER,
      username: 'edna',
    });
    await request(ctx.app.getHttpServer())
      .delete(`/users/${ghost.userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    await request(ctx.app.getHttpServer())
      .post(`/tickets/${ticketId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ authorId: ghost.userId, content: 'hello' })
      .expect(HttpStatus.NOT_FOUND);
  });
});
