import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { buildTypeOrmOptions } from './config/typeorm.config';
import { HealthController } from './health.controller';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { TicketsModule } from './tickets/tickets.module';
import { CommentsModule } from './comments/comments.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { DependenciesModule } from './tickets/dependencies/dependencies.module';
import { AttachmentsModule } from './tickets/attachments/attachments.module';
import { EscalationModule } from './tickets/escalation/escalation.module';
import { AutoAssignModule } from './tickets/auto-assign/auto-assign.module';
import { RolesGuard } from './common/guards/roles.guard';
import { ETagInterceptor } from './common/interceptors/etag.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildTypeOrmOptions(config),
    }),
    ScheduleModule.forRoot(),
    // Throttler is wired here so any controller can opt-in via
    // `@UseGuards(ThrottlerGuard)` + `@Throttle(...)`. We deliberately do NOT
    // register ThrottlerGuard as APP_GUARD — a global guard would rate-limit
    // every route and produce noisy 429s across the e2e suite. The login
    // route applies it route-locally. Defaults below are generous and only
    // kick in if a future caller opts in without their own `@Throttle`
    // override. The skipIf bypass disables throttling under NODE_ENV=test so
    // the e2e suite (which logs in many test users from the same loopback IP
    // in a tight loop) doesn't trip the per-IP quota; production behaviour is
    // unchanged.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    AuditLogModule,
    UsersModule,
    AuthModule,
    ProjectsModule,
    TicketsModule,
    CommentsModule,
    DependenciesModule,
    AttachmentsModule,
    EscalationModule,
    AutoAssignModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global guards run in registration order. JwtAuthGuard MUST come first so
    // it populates `request.user`; RolesGuard then reads `user.role` to enforce
    // `@Roles(...)` annotations. Handlers without `@Roles` short-circuit to
    // allow inside RolesGuard.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Strip the internal `version` field from responses and emit it as a weak
    // ETag header instead, so optimistic concurrency is carried purely over
    // HTTP headers.
    { provide: APP_INTERCEPTOR, useClass: ETagInterceptor },
    // Catch-all exception filter: passes HttpException through unchanged,
    // and renders any other thrown value as a generic 500 with a logged
    // stack so we never leak internal error strings over the wire.
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
