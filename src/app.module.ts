import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { buildTypeOrmOptions } from './config/typeorm.config';
import { HealthController } from './health.controller';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildTypeOrmOptions(config),
    }),
    ScheduleModule.forRoot(),
    UsersModule,
  ],
  controllers: [HealthController],
  providers: [
    // TODO Agent 3: register JwtAuthGuard as APP_GUARD here.
  ],
})
export class AppModule {}
