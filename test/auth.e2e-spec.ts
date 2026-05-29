import * as request from 'supertest';
import { HttpStatus } from '@nestjs/common';
import { createTestApp, TestAppContext } from './test-app.factory';
import { UserRole } from '../src/common/enums/user-role.enum';
import { UsersService } from '../src/users/users.service';
import { InvalidatedTokensService } from '../src/auth/invalidated-tokens.service';

describe('Auth (e2e)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('protected route returns 401 without a token', async () => {
    await request(ctx.app.getHttpServer()).get('/auth/me').expect(HttpStatus.UNAUTHORIZED);
  });

  it('login → /auth/me returns the user', async () => {
    const t = await ctx.obtainToken({ role: UserRole.DEVELOPER });
    const me = await request(ctx.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(HttpStatus.OK);
    expect(me.body.id).toBe(t.userId);
    expect(me.body).not.toHaveProperty('passwordHash');
  });

  it('logout invalidates the token; subsequent /auth/me returns 401', async () => {
    const t = await ctx.obtainToken({ role: UserRole.DEVELOPER });
    await request(ctx.app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(HttpStatus.OK);
    await request(ctx.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(HttpStatus.UNAUTHORIZED);
  });

  it('logout invalidates the exact-jti token until its real expiry', async () => {
    const t = await ctx.obtainToken({ role: UserRole.DEVELOPER });
    // Decode the JWT payload (middle segment, base64url) to read the real `exp`/`jti`.
    const [, payloadSegment] = t.accessToken.split('.');
    const payloadJson = Buffer.from(payloadSegment, 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson) as { exp: number; jti: string };
    expect(typeof payload.exp).toBe('number');
    expect(typeof payload.jti).toBe('string');

    await request(ctx.app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(HttpStatus.OK);

    // Subsequent calls with the same token must be rejected.
    await request(ctx.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(HttpStatus.UNAUTHORIZED);

    // The deny-list entry must persist until the token's real `exp`, not 24h
    // from now (which used to be the hand-rolled fallback).
    const invalidated = ctx.app.get(InvalidatedTokensService);
    const stillBlocked = await invalidated.has(payload.jti);
    expect(stillBlocked).toBe(true);
  });

  it('soft-deleted user cannot use a previously-issued token', async () => {
    const t = await ctx.obtainToken({ role: UserRole.DEVELOPER });
    const users = ctx.app.get(UsersService);
    await users.softDelete(t.userId);
    await request(ctx.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(HttpStatus.UNAUTHORIZED);
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
      .expect(HttpStatus.UNAUTHORIZED);
  });
});
