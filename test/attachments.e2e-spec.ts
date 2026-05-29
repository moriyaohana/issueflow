import * as request from 'supertest';
import { HttpStatus } from '@nestjs/common';
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
    ticketId = ticket.body.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('upload PNG → returns metadata; delete → 200; delete again → 404', async () => {
    const upload = await request(ctx.app.getHttpServer())
      .post(`/tickets/${ticketId}/attachments`)
      .set('Authorization', `Bearer ${adminToken}`)
      // PNG signature + padding. `FileTypeValidator` now inspects magic
      // numbers (it no longer trusts Content-Type), and the underlying
      // `file-type` parser reads a chunk header past the 8-byte signature,
      // so the buffer must be long enough for that lookahead to succeed.
      .attach(
        'file',
        Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(64, 0),
        ]),
        {
          filename: 'screenshot.png',
          contentType: 'image/png',
        },
      )
      .expect(HttpStatus.OK);
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
      .expect(HttpStatus.OK);

    await request(ctx.app.getHttpServer())
      .delete(`/tickets/${ticketId}/attachments/${upload.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('rejects an executable mime type with 400', async () => {
    await request(ctx.app.getHttpServer())
      .post(`/tickets/${ticketId}/attachments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from([0]), {
        filename: 'bad.exe',
        contentType: 'application/x-msdownload',
      })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('upload with no file returns 400', async () => {
    await request(ctx.app.getHttpServer())
      .post(`/tickets/${ticketId}/attachments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('cascading hard-delete on ticket soft-delete: deleting the ticket purges its attachments', async () => {
    const project = await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'pp', description: 'd', ownerId: adminUserId })
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
    const upload = await request(ctx.app.getHttpServer())
      .post(`/tickets/${ticket.body.id}/attachments`)
      .set('Authorization', `Bearer ${adminToken}`)
      // The validator now inspects magic numbers, and `file-type` cannot
      // detect plain text. Use a minimal PDF (which has a real `%PDF-`
      // signature) with padding so the parser's lookahead doesn't fall off
      // the end of the buffer — the goal of this case is to assert cascade
      // behaviour, not to exercise text/plain specifically.
      .attach(
        'file',
        Buffer.concat([
          Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'),
          Buffer.alloc(64, 0),
        ]),
        {
          filename: 'a.pdf',
          contentType: 'application/pdf',
        },
      )
      .expect(HttpStatus.OK);
    await request(ctx.app.getHttpServer())
      .delete(`/tickets/${ticket.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', ticket.headers.etag)
      .expect(HttpStatus.OK);
    const audit = await request(ctx.app.getHttpServer())
      .get(
        `/audit-logs?entityType=ATTACHMENT&entityId=${upload.body.id}&action=DELETE`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(
      audit.body.find((r: any) => r.metadata?.cascade === 'soft'),
    ).toBeTruthy();
  });
});
