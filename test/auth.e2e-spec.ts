import * as request from 'supertest';
import { createTestApp, TestAppContext } from './test-app.factory';
import { UserRole } from '../src/common/enums/user-role.enum';
import { UsersService } from '../src/users/users.service';

describe('Auth (e2e)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('protected route returns 401 without a token', async () => {
    await request(ctx.app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('login → /auth/me returns the user', async () => {
    const t = await ctx.obtainToken({ role: UserRole.DEVELOPER });
    const me = await request(ctx.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(200);
    expect(me.body.id).toBe(t.userId);
    expect(me.body).not.toHaveProperty('passwordHash');
  });

  it('logout invalidates the token; subsequent /auth/me returns 401', async () => {
    const t = await ctx.obtainToken({ role: UserRole.DEVELOPER });
    await request(ctx.app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(200);
    await request(ctx.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(401);
  });

  it('soft-deleted user cannot use a previously-issued token', async () => {
    const t = await ctx.obtainToken({ role: UserRole.DEVELOPER });
    const users = ctx.app.get(UsersService);
    await users.softDelete(t.userId);
    await request(ctx.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(401);
  });

  it('login with wrong password returns 401', async () => {
    const adminUsername = `admin_wp_${Date.now()}`;
    const users = ctx.app.get(UsersService);
    await users.create({
      username: adminUsername,
      email: `${adminUsername}@example.com`,
      fullName: 'WP',
      role: UserRole.ADMIN,
      password: 'correct-password',
    });
    await request(ctx.app.getHttpServer())
      .post('/auth/login')
      .send({ username: adminUsername, password: 'wrong-password' })
      .expect(401);
  });
});
