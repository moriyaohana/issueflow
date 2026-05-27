import * as request from 'supertest';
import { createTestApp, TestAppContext } from './test-app.factory';
import { UserRole } from '../src/common/enums/user-role.enum';

describe('Users (e2e)', () => {
  let ctx: TestAppContext;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const t = await ctx.obtainToken({ role: UserRole.ADMIN });
    token = t.accessToken;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('create → fetch → update → fetch → delete → 404 lifecycle', async () => {
    const create = await request(ctx.app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        username: 'jdoe',
        email: 'jdoe@example.com',
        fullName: 'John Doe',
        role: 'DEVELOPER',
        password: 'secret-pw-12345',
      })
      .expect(200);

    expect(create.body).toMatchObject({
      username: 'jdoe',
      email: 'jdoe@example.com',
      fullName: 'John Doe',
      role: 'DEVELOPER',
    });
    expect(create.body).not.toHaveProperty('password');
    expect(create.body).not.toHaveProperty('passwordHash');
    const userId = create.body.id;

    const fetched = await request(ctx.app.getHttpServer())
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(fetched.body.id).toBe(userId);
    expect(fetched.body).not.toHaveProperty('passwordHash');

    await request(ctx.app.getHttpServer())
      .post(`/users/update/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Jane Doe', role: 'ADMIN' })
      .expect(200);

    const updated = await request(ctx.app.getHttpServer())
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(updated.body.fullName).toBe('Jane Doe');
    expect(updated.body.role).toBe('ADMIN');

    await request(ctx.app.getHttpServer())
      .delete(`/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(ctx.app.getHttpServer())
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    const list = await request(ctx.app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.find((u: any) => u.id === userId)).toBeUndefined();
  });

  it('rejects duplicate username with 409', async () => {
    await request(ctx.app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        username: 'dup',
        email: 'dup1@example.com',
        fullName: 'Dup One',
        role: 'DEVELOPER',
        password: 'secret-pw-12345',
      })
      .expect(200);

    await request(ctx.app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        username: 'dup',
        email: 'dup2@example.com',
        fullName: 'Dup Two',
        role: 'DEVELOPER',
        password: 'secret-pw-12345',
      })
      .expect(409);
  });

  it('rejects invalid create payloads with 400', async () => {
    await request(ctx.app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        username: 'bad',
        email: 'not-an-email',
        fullName: 'Bad Email',
        role: 'DEVELOPER',
        password: 'secret-pw-12345',
      })
      .expect(400);

    await request(ctx.app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        username: 'short',
        email: 'short@example.com',
        fullName: 'Short',
        role: 'DEVELOPER',
        password: 'short',
      })
      .expect(400);
  });

  it('rejects unauthenticated requests with 401', async () => {
    await request(ctx.app.getHttpServer()).get('/users').expect(401);
  });
});
