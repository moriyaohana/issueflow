import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../enums/user-role.enum';

function mockContext(user: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows the request when no @Roles metadata is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(mockContext({ role: UserRole.DEVELOPER }))).toBe(true);
  });

  it('allows ADMIN when @Roles(ADMIN) is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    expect(guard.canActivate(mockContext({ role: UserRole.ADMIN }))).toBe(true);
  });

  it('rejects DEVELOPER when @Roles(ADMIN) is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    expect(() => guard.canActivate(mockContext({ role: UserRole.DEVELOPER }))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects an unauthenticated request when roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    expect(() => guard.canActivate(mockContext(undefined))).toThrow(ForbiddenException);
  });
});
