import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserPayload {
  id: number;
  username: string;
  role: string;
  jti: string;
  exp: number;
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: CurrentUserPayload | undefined = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
