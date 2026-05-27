import {
  INestApplication,
  ValidationPipe,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { UserRole } from '../src/common/enums/user-role.enum';

export interface TestAppContext {
  app: INestApplication;
  dataSource: DataSource;
  close: () => Promise<void>;
  obtainToken: (opts?: ObtainTokenOptions) => Promise<TokenInfo>;
}

export interface ObtainTokenOptions {
  role?: UserRole;
  username?: string;
  email?: string;
  fullName?: string;
  password?: string;
}

export interface TokenInfo {
  accessToken: string;
  userId: number;
  username: string;
  role: UserRole;
}

let tokenSeq = 0;

export async function createTestApp(): Promise<TestAppContext> {
  process.env.NODE_ENV = 'test';

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  await app.init();

  const dataSource = app.get(DataSource);
  const usersService = app.get(UsersService);

  async function obtainToken(opts: ObtainTokenOptions = {}): Promise<TokenInfo> {
    const role = opts.role ?? UserRole.DEVELOPER;
    const seq = ++tokenSeq;
    const username = opts.username ?? `tester_${seq}`;
    const email = opts.email ?? `tester_${seq}@example.com`;
    const fullName = opts.fullName ?? `Tester ${seq}`;
    const password = opts.password ?? 'secret-pw-12345';

    const created = await usersService.create({
      username,
      email,
      fullName,
      role,
      password,
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password })
      .expect(200);

    return {
      accessToken: res.body.accessToken,
      userId: created.id,
      username,
      role,
    };
  }

  return {
    app,
    dataSource,
    close: async () => {
      await app.close();
    },
    obtainToken,
  };
}
