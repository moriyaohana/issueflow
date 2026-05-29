import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { UserRole } from '../enums/user-role.enum';

export interface CurrentUserPayload {
  id: number;
  username: string;
  role: UserRole;
  jti: string;
  exp: number;
}

/**
 * Param decorator that exposes the authenticated user attached to
 * `request.user` by `JwtAuthGuard`. The return type is non-nullable, so a
 * handler that uses `@CurrentUser()` on a `@Public()` route (where the guard
 * skips authentication) would otherwise silently receive `undefined` and
 * 500 deep in the controller body.
 *
 * Instead, we throw `BadRequestException` here so the misuse surfaces as a
 * clear 4xx with a diagnostic message. Handlers that genuinely need optional
 * access should declare a separate `@OptionalCurrentUser()` decorator.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: CurrentUserPayload | undefined = request.user;
    if (!user) {
      throw new BadRequestException(
        'CurrentUser is not available on this route — is the route public or is the JwtAuthGuard missing?',
      );
    }
    return data ? user[data] : user;
  },
);
