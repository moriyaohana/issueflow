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
