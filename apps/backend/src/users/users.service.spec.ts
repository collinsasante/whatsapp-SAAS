import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserRole } from '@whatsapp-platform/shared-types';

function build() {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'target-1', role: UserRole.AGENT }),
    },
  };
  const service = new UsersService(prisma as never);
  return { service, prisma };
}

function actor(role: UserRole, sub = 'actor-1'): { sub: string; role: UserRole } {
  return { sub, role };
}

describe('UsersService.update -- privilege escalation regression', () => {
  it('rejects an actor changing their own role', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'actor-1' });

    await expect(
      service.update('tenant-1', 'actor-1', { role: UserRole.SUPER_ADMIN }, actor(UserRole.ADMIN, 'actor-1') as never),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an ADMIN granting SUPER_ADMIN to someone else', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'target-1' });

    await expect(
      service.update('tenant-1', 'target-1', { role: UserRole.SUPER_ADMIN }, actor(UserRole.ADMIN) as never),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows a SUPER_ADMIN to grant SUPER_ADMIN to someone else', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'target-1' });

    await service.update('tenant-1', 'target-1', { role: UserRole.SUPER_ADMIN }, actor(UserRole.SUPER_ADMIN) as never);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { role: UserRole.SUPER_ADMIN },
      select: expect.any(Object),
    });
  });

  it('allows an ADMIN to grant AGENT (a lower rank) to someone else', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'target-1' });

    await service.update('tenant-1', 'target-1', { role: UserRole.AGENT }, actor(UserRole.ADMIN) as never);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { role: UserRole.AGENT },
      select: expect.any(Object),
    });
  });

  it('does not run the role check at all when role is not in the DTO', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'target-1' });

    await service.update('tenant-1', 'target-1', { name: 'New Name' }, actor(UserRole.AGENT) as never);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { name: 'New Name' },
      select: expect.any(Object),
    });
  });
});
