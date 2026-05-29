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
    // Throttler is wired here but not registered as APP_GUARD: callers opt in
    // route-locally so the e2e suite (lots of loopback logins) isn't affected,
    // and skipIf disables the limiter entirely under NODE_ENV=test.
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
    // JwtAuthGuard must register before RolesGuard so request.user exists
    // before RolesGuard reads user.role.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: ETagInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
