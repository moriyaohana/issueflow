import * as request from 'supertest';
import { HttpStatus } from '@nestjs/common';
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
      .expect(HttpStatus.OK);

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
      .expect(HttpStatus.OK);
    expect(fetched.body.id).toBe(userId);
    expect(fetched.body).not.toHaveProperty('passwordHash');

    await request(ctx.app.getHttpServer())
      .post(`/users/update/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Jane Doe', role: 'ADMIN' })
      .expect(HttpStatus.OK);

    const updated = await request(ctx.app.getHttpServer())
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(updated.body.fullName).toBe('Jane Doe');
    expect(updated.body.role).toBe('ADMIN');

    await request(ctx.app.getHttpServer())
      .delete(`/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    await request(ctx.app.getHttpServer())
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    const list = await request(ctx.app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
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
      .expect(HttpStatus.OK);

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
      .expect(HttpStatus.CONFLICT);
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
      .expect(HttpStatus.BAD_REQUEST);

    await request(ctx.app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        username: 'empty-pw',
        email: 'empty@example.com',
        fullName: 'Empty Password',
        role: 'DEVELOPER',
        password: '',
      })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('rejects unauthenticated requests with 401', async () => {
    await request(ctx.app.getHttpServer())
      .get('/users')
      .expect(HttpStatus.UNAUTHORIZED);
  });
});
