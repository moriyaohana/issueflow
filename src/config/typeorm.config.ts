import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { config as loadEnv } from 'dotenv';
import * as path from 'path';

const isTest = process.env.NODE_ENV === 'test';

export const buildTypeOrmOptions = (config: ConfigService): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: config.get<string>('DB_HOST', 'localhost'),
  port: parseInt(config.get<string>('DB_PORT', '5432'), 10),
  username: config.get<string>('DB_USER', 'issueflow'),
  password: config.get<string>('DB_PASSWORD', 'issueflow'),
  database: config.get<string>('DB_NAME', 'issueflow'),
  entities: [path.join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [path.join(__dirname, '..', 'migrations', '*.{ts,js}')],
  synchronize: isTest,
  dropSchema: isTest,
  autoLoadEntities: true,
});

loadEnv();

const cliDataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER || 'issueflow',
  password: process.env.DB_PASSWORD || 'issueflow',
  database: process.env.DB_NAME || 'issueflow',
  entities: [path.join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [path.join(__dirname, '..', 'migrations', '*.{ts,js}')],
  synchronize: false,
};

export default new DataSource(cliDataSourceOptions);
