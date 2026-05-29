import * as request from 'supertest';
import { HttpStatus } from '@nestjs/common';
import { createTestApp, TestAppContext } from './test-app.factory';
import { UserRole } from '../src/common/enums/user-role.enum';

describe('Projects (e2e)', () => {
  let ctx: TestAppContext;
  let adminToken: string;
  let devToken: string;
  let ownerUserId: number;

  beforeAll(async () => {
    ctx = await createTestApp();
    const admin = await ctx.obtainToken({ role: UserRole.ADMIN });
    const dev = await ctx.obtainToken({ role: UserRole.DEVELOPER });
    adminToken = admin.accessToken;
    devToken = dev.accessToken;
    ownerUserId = admin.userId;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('lifecycle: create → list → delete → list-deleted → restore', async () => {
    const create = await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Sample', description: 'desc', ownerId: ownerUserId })
      .expect(HttpStatus.OK);
    const projectId = create.body.id;

    const list1 = await request(ctx.app.getHttpServer())
      .get('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(list1.body.find((p: any) => p.id === projectId)).toBeTruthy();

    await request(ctx.app.getHttpServer())
      .delete(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);

    const list2 = await request(ctx.app.getHttpServer())
      .get('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(list2.body.find((p: any) => p.id === projectId)).toBeUndefined();

    const deletedList = await request(ctx.app.getHttpServer())
      .get('/projects/deleted')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(deletedList.body.find((p: any) => p.id === projectId)).toBeTruthy();

    await request(ctx.app.getHttpServer())
      .post(`/projects/${projectId}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);

    const list3 = await request(ctx.app.getHttpServer())
      .get('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    expect(list3.body.find((p: any) => p.id === projectId)).toBeTruthy();
  });

  it('DEVELOPER cannot access /projects/deleted or /restore', async () => {
    await request(ctx.app.getHttpServer())
      .get('/projects/deleted')
      .set('Authorization', `Bearer ${devToken}`)
      .expect(HttpStatus.FORBIDDEN);

    const c = await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'r', description: 'd', ownerId: ownerUserId })
      .expect(HttpStatus.OK);
    await request(ctx.app.getHttpServer())
      .delete(`/projects/${c.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);

    await request(ctx.app.getHttpServer())
      .post(`/projects/${c.body.id}/restore`)
      .set('Authorization', `Bearer ${devToken}`)
      .expect(HttpStatus.FORBIDDEN);
  });

  it('rejects creating a project with a soft-deleted owner', async () => {
    const orphan = await ctx.obtainToken({ role: UserRole.DEVELOPER });
    await request(ctx.app.getHttpServer())
      .delete(`/users/${orphan.userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    await request(ctx.app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'orphan', description: 'd', ownerId: orphan.userId })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('GET /projects/deleted route resolves before GET /projects/:id', async () => {
    await request(ctx.app.getHttpServer())
      .get('/projects/deleted')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
  });
});
