import { BadRequestException } from '@nestjs/common';
import { BillingService } from './billing.service';

function build(user: { email: string } | null = { email: 'owner@acme.test' }) {
  const prisma = { user: { findFirst: jest.fn().mockResolvedValue(user) } };
  const svc = Object.create(BillingService.prototype) as Record<string, unknown>;
  Object.assign(svc, { prisma });
  return { svc: svc as unknown as BillingService, prisma };
}

describe('BillingService.resolveBillingEmail', () => {
  it('prefers the email typed for this purchase', async () => {
    const { svc, prisma } = build();
    expect(await svc.resolveBillingEmail('t1', 'u1', ' pay@acme.test ', 'saved@acme.test')).toBe('pay@acme.test');
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('then the workspace billing email', async () => {
    const { svc, prisma } = build();
    expect(await svc.resolveBillingEmail('t1', 'u1', undefined, 'saved@acme.test')).toBe('saved@acme.test');
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('then the signed-in user\'s own email, looked up inside their own tenant only', async () => {
    const { svc, prisma } = build();
    expect(await svc.resolveBillingEmail('tenant-A', 'user-1', undefined, null)).toBe('owner@acme.test');
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { id: 'user-1', tenantId: 'tenant-A' }, select: { email: true } });
  });

  it('does not use a user from another tenant (lookup finds nothing -> clear error)', async () => {
    const { svc } = build(null);
    await expect(svc.resolveBillingEmail('tenant-A', 'user-of-B', undefined, null)).rejects.toThrow(BadRequestException);
  });

  it.each([[undefined, null], ['', null], ['   ', '  ']])('fails with an actionable message when no email exists (%j, %j) and there is no user', async (req, saved) => {
    const { svc } = build();
    await expect(svc.resolveBillingEmail('t1', undefined, req, saved)).rejects.toThrow('Add a billing email');
  });

  it.each(['not-an-email', 'a@b', '@x.test', 'a b@c.test'])('rejects an invalid address %j', async (bad) => {
    const { svc } = build();
    await expect(svc.resolveBillingEmail('t1', 'u1', bad, null)).rejects.toThrow(BadRequestException);
  });
});
