import * as request from 'supertest';
import { HttpStatus } from '@nestjs/common';
import { createTestApp, TestAppContext } from './test-app.factory';

describe('Health (e2e)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('GET / responds 200 with status ok', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/').expect(HttpStatus.OK);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
