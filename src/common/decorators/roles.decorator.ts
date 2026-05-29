import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../enums/user-role.enum';

export const ROLES_KEY = 'issueflow:roles';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
