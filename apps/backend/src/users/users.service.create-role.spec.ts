import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@whatsapp-platform/shared-types';
import { UsersService } from './users.service';

function build() {
  const tx = {
    user: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'new-user', ...data })) },
    workspaceMember: { upsert: jest.fn().mockResolvedValue({}) },
    digitalSelf: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    subscription: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { count: jest.fn().mockResolvedValue(0), findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { service: new UsersService(prisma as never), tx, prisma };
}
const actor = (role: UserRole) => ({ sub: 'actor', role }) as never;
const dto = (role?: UserRole) => ({ email: 'n@acme.test', name: 'New', password: 'Passw0rd!x', ...(role && { role }) }) as never;

describe('UsersService.create -- the persisted workspace role matches the requested role', () => {
  it.each([[UserRole.ADMIN, 'ADMIN'], [UserRole.AGENT, 'AGENT'], [UserRole.VIEWER, 'VIEWER']])('creating a %s persists a %s membership (VIEWER used to become AGENT)', async (role, expected) => {
    const { service, tx } = build();
    await service.create('t1', dto(role), actor(UserRole.SUPER_ADMIN));
    expect(tx.user.create.mock.calls[0][0].data.role).toBe(role);
    expect(tx.workspaceMember.upsert.mock.calls[0][0].create).toMatchObject({ workspaceId: 't1', role: expected, status: 'ACTIVE' });
    // Every reply-capable user gets a Digital Self in the same transaction; a view-only user does not.
    expect(tx.digitalSelf.createMany).toHaveBeenCalledTimes(role === UserRole.VIEWER ? 0 : 1);
  });

  it('defaults to Agent when no role is given', async () => {
    const { service, tx } = build();
    await service.create('t1', dto(), actor(UserRole.ADMIN));
    expect(tx.workspaceMember.upsert.mock.calls[0][0].create.role).toBe('AGENT');
  });

  it('an Admin cannot create a SUPER_ADMIN, and nothing is written', async () => {
    const { service, tx, prisma } = build();
    await expect(service.create('t1', dto(UserRole.SUPER_ADMIN), actor(UserRole.ADMIN))).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('an Admin can create an Admin or an Agent', async () => {
    const { service } = build();
    await expect(service.create('t1', dto(UserRole.ADMIN), actor(UserRole.ADMIN))).resolves.toBeDefined();
    await expect(service.create('t1', dto(UserRole.AGENT), actor(UserRole.ADMIN))).resolves.toBeDefined();
  });

  it('even when a SUPER_ADMIN acts, the membership never becomes an Owner through this path', async () => {
    const { service, tx } = build();
    await service.create('t1', dto(UserRole.SUPER_ADMIN), actor(UserRole.SUPER_ADMIN));
    expect(tx.workspaceMember.upsert.mock.calls[0][0].create.role).not.toBe('OWNER');
  });
});
