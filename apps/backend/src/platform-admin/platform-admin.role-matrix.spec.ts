import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PlatformAdminController } from './platform-admin.controller';
import { PLATFORM_ROLES_KEY, PlatformAdminRole } from './decorators/require-platform-role.decorator';
import { PlatformAdminGuard } from './platform-admin.guard';

/**
 * Role/action matrix, read from the controller's own metadata so a new route cannot be added without an explicit decision.
 *   VIEWER: read only.  SUPPORT: operational actions on workspaces/users/errors.  SUPER_ADMIN: money, plans, entitlements, admins, flags.
 */
const PUBLIC_AUTH_ROUTES = new Set(['POST auth/setup', 'POST auth/login', 'POST auth/forgot-password', 'POST auth/reset-password']);
const SUPPORT_ALLOWED = new Set(['PATCH errors/:id/status', 'PATCH workspaces/:id', 'PATCH workspaces/:id/suspend', 'PATCH workspaces/:id/activate', 'PATCH users/:id/toggle-active']);

type Route = { key: string; method: string; roles: PlatformAdminRole[] | undefined; guarded: boolean };
function routes(): Route[] {
  const proto = PlatformAdminController.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function' && Reflect.hasMetadata(PATH_METADATA, proto[name] as object))
    .map((name) => {
      const handler = proto[name] as object;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)];
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
      const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[];
      return { key: `${method} ${path}`, method, roles: Reflect.getMetadata(PLATFORM_ROLES_KEY, handler), guarded: guards.includes(PlatformAdminGuard) };
    });
}

describe('platform admin role matrix', () => {
  const all = routes();

  it('finds the whole surface', () => expect(all.length).toBeGreaterThan(55));

  it('every route except sign-in/setup/password reset sits behind PlatformAdminGuard', () => {
    expect(all.filter((r) => !r.guarded).map((r) => r.key).sort()).toEqual([...PUBLIC_AUTH_ROUTES].sort());
  });

  it('no mutating route is open to a VIEWER: each names its roles explicitly', () => {
    const open = all.filter((r) => r.method !== 'GET' && !PUBLIC_AUTH_ROUTES.has(r.key) && (!r.roles || r.roles.includes('VIEWER')));
    expect(open.map((r) => r.key)).toEqual([]);
  });

  it('SUPPORT can only perform the operational actions on the allow-list; everything else is SUPER_ADMIN only', () => {
    const supportCan = all.filter((r) => r.method !== 'GET' && r.guarded && r.roles?.includes('SUPPORT')).map((r) => r.key).sort();
    expect(supportCan).toEqual([...SUPPORT_ALLOWED].sort());
    for (const r of all.filter((x) => x.method !== 'GET' && x.guarded && !SUPPORT_ALLOWED.has(x.key))) expect(r.roles).toEqual(['SUPER_ADMIN']);
  });

  it.each([
    'PATCH settings/commerce-fee', 'POST workspaces/:id/credits/grant', 'PATCH workspaces/:id/force-plan', 'PATCH workspaces/:id/commerce',
    'PATCH admins/:id/role', 'POST admins', 'POST plans', 'PATCH plans/:id', 'POST ai/pricing', 'PATCH ai/credit-packages/:id', 'POST webhooks/:id/reprocess',
  ])('%s (money, entitlement, admin or replay action) is SUPER_ADMIN only', (key) => {
    expect(all.find((r) => r.key === key)?.roles).toEqual(['SUPER_ADMIN']);
  });
});
