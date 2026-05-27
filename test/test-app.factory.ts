import { INestApplication, ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

export interface TestAppContext {
  app: INestApplication;
  dataSource: DataSource;
  close: () => Promise<void>;
}

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

  return {
    app,
    dataSource,
    close: async () => {
      await app.close();
    },
  };
}
