import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { InvalidatedToken } from './entities/invalidated-token.entity';
import { InvalidatedTokensService } from './invalidated-tokens.service';
import { UsersModule } from '../users/users.module';

// JwtAuthGuard is registered as APP_GUARD inside AppModule so its execution
// order relative to RolesGuard is deterministic (JwtAuthGuard runs first so
// `request.user` is populated before RolesGuard reads it).
@Module({
  imports: [
    UsersModule,
    PassportModule,
    TypeOrmModule.forFeature([InvalidatedToken]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'dev-secret-change-me'),
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, InvalidatedTokensService, JwtAuthGuard],
  controllers: [AuthController],
  exports: [AuthService, InvalidatedTokensService, JwtAuthGuard],
})
export class AuthModule {}
