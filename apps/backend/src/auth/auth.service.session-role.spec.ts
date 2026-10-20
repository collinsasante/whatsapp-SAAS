import { UserRole } from '@whatsapp-platform/shared-types';
import { AuthService } from './auth.service';

function build(opts: { membershipRole?: string | null; legacyRole?: string } = {}) {
  const user = { id: 'u1', email: 'owner@acme.test', name: 'Ola', role: opts.legacyRole ?? 'AGENT', tenantId: 't1' };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ ...user, avatarUrl: null }) },
    tenant: { findUnique: jest.fn().mockResolvedValue({ id: 't1', name: 'Acme', onboardingCompleted: true, plan: 'free', logoUrl: null }) },
    workspaceMember: { findFirst: jest.fn().mockResolvedValue(opts.membershipRole === null ? null : { role: opts.membershipRole ?? 'OWNER' }) },
  };
  const svc = Object.create(AuthService.prototype) as Record<string, unknown>;
  Object.assign(svc, { prisma });
  // resolveSessionRole is private on purpose; reach it through a typed view for the test only.
  const view = svc as unknown as {
    getMe: AuthService["getMe"];
    resolveSessionRole: (u: string, w: string, r: string) => Promise<{ role: UserRole; workspaceRole: string }>;
  };
  return { svc: view, prisma };
}

describe('the role a person sees and signs in with comes from their membership', () => {
  it('an invited Owner whose legacy column says AGENT is an Owner (SUPER_ADMIN access) in /me', async () => {
    const { svc } = build({ membershipRole: 'OWNER', legacyRole: 'AGENT' });
    const me = await svc.getMe('u1') as { user: { role: string; workspaceRole: string } };
    expect(me.user.workspaceRole).toBe('OWNER');
    expect(me.user.role).toBe(UserRole.SUPER_ADMIN);
  });

  it('an Agent stays an Agent: no Owner permissions leak through', async () => {
    const { svc } = build({ membershipRole: 'AGENT', legacyRole: 'ADMIN' });
    const me = await svc.getMe('u1') as { user: { role: string; workspaceRole: string } };
    expect(me.user.workspaceRole).toBe('AGENT');
    expect(me.user.role).toBe(UserRole.AGENT); // membership wins even over a higher legacy value
  });

  it('only an ACTIVE membership in the same workspace counts', async () => {
    const { svc, prisma } = build();
    await svc.resolveSessionRole('u1', 'tenant-A', 'AGENT');
    expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith({ where: { userId: 'u1', workspaceId: 'tenant-A', status: 'ACTIVE' }, select: { role: true } });
  });

  it('with no membership it falls back to the legacy role', async () => {
    const { svc } = build({ membershipRole: null, legacyRole: 'ADMIN' });
    expect(await svc.resolveSessionRole('u1', 't1', 'ADMIN')).toEqual({ role: UserRole.ADMIN, workspaceRole: 'ADMIN' });
  });

  it.each([['OWNER', UserRole.SUPER_ADMIN], ['ADMIN', UserRole.ADMIN], ['MANAGER', UserRole.ADMIN], ['AGENT', UserRole.AGENT], ['ANALYST', UserRole.VIEWER], ['VIEWER', UserRole.VIEWER]])(
    'membership %s signs in as %s and keeps its workspace role name', async (membershipRole, expected) => {
      const { svc } = build({ membershipRole });
      expect(await svc.resolveSessionRole('u1', 't1', 'AGENT')).toEqual({ role: expected, workspaceRole: membershipRole });
    });
});

describe('getMe returns the workspace in the token, not the home workspace', () => {
  it('looks up the tenant and the role in the active workspace', async () => {
    const { svc, prisma } = build({ membershipRole: 'MANAGER' });
    prisma.tenant.findUnique.mockResolvedValue({ id: 'ws-other', name: 'Other Co', onboardingCompleted: true, plan: 'free', logoUrl: null });
    const me = await svc.getMe('u1', 'ws-other') as { tenant: { id: string }; user: { workspaceRole: string } };
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ws-other' } }));
    expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith({ where: { userId: 'u1', workspaceId: 'ws-other', status: 'ACTIVE' }, select: { role: true } });
    expect(me.tenant.id).toBe('ws-other');
    expect(me.user.workspaceRole).toBe('MANAGER');
  });

  it('falls back to the home workspace when none is given', async () => {
    const { svc, prisma } = build();
    await svc.getMe('u1');
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't1' } }));
  });
});
