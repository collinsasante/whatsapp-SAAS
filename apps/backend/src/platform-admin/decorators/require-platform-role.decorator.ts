import { SetMetadata } from '@nestjs/common';

export type PlatformAdminRole = 'SUPER_ADMIN' | 'SUPPORT' | 'VIEWER';

export const PLATFORM_ROLES_KEY = 'platformRoles';

/** Restricts a route to specific PlatformAdmin.role values. Omit entirely to allow any authenticated platform admin (read endpoints). */
export const RequirePlatformRole = (...roles: PlatformAdminRole[]) => SetMetadata(PLATFORM_ROLES_KEY, roles);
