import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';

function build() {
  const prisma = {
    workspaceMember: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'member-1' }),
    },
    user: {
      update: jest.fn().mockResolvedValue({ id: 'user-1' }),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as never[])),
  };
  const configService = { get: jest.fn() };
  const auditService = { log: jest.fn().mockResolvedValue(undefined) };
  const realtimeService = { emitRoleChanged: jest.fn(), emitMemberUpdated: jest.fn() };
  const emailService = {};
  const service = new WorkspaceService(
    prisma as never,
    configService as never,
    auditService as never,
    realtimeService as never,
    emailService as never,
  );
  return { service, prisma };
}

describe('WorkspaceService.editMember -- privilege escalation regression', () => {
  it('rejects a self role change even when the caller is ADMIN-gated', async () => {
    const { service, prisma } = build();
    // The target member IS the actor (self-edit).
    prisma.workspaceMember.findFirst.mockResolvedValueOnce({
      id: 'member-1', userId: 'actor-1', role: 'MANAGER', workspaceId: 'tenant-1',
    });

    await expect(
      service.editMember('tenant-1', 'member-1', 'actor-1', { role: 'OWNER' }),
    ).rejects.toThrow(ForbiddenException);

    // Must never reach the write.
    expect(prisma.workspaceMember.update).not.toHaveBeenCalled();
  });

  it('rejects a self status change the same way', async () => {
    const { service, prisma } = build();
    prisma.workspaceMember.findFirst.mockResolvedValueOnce({
      id: 'member-1', userId: 'actor-1', role: 'ADMIN', workspaceId: 'tenant-1',
    });

    await expect(
      service.editMember('tenant-1', 'member-1', 'actor-1', { status: 'ACTIVE' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a MANAGER granting OWNER to someone else', async () => {
    const { service, prisma } = build();
    prisma.workspaceMember.findFirst
      .mockResolvedValueOnce({ id: 'member-2', userId: 'other-user', role: 'AGENT', workspaceId: 'tenant-1' }) // target
      .mockResolvedValueOnce({ role: 'MANAGER' }); // actor's own membership

    await expect(
      service.editMember('tenant-1', 'member-2', 'actor-1', { role: 'OWNER' }),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.workspaceMember.update).not.toHaveBeenCalled();
  });

  it('rejects an ADMIN editing a peer ADMIN (equal rank)', async () => {
    const { service, prisma } = build();
    prisma.workspaceMember.findFirst
      .mockResolvedValueOnce({ id: 'member-2', userId: 'other-user', role: 'ADMIN', workspaceId: 'tenant-1' })
      .mockResolvedValueOnce({ role: 'ADMIN' });

    await expect(
      service.editMember('tenant-1', 'member-2', 'actor-1', { status: 'SUSPENDED' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects an invalid role string outright', async () => {
    const { service, prisma } = build();
    prisma.workspaceMember.findFirst
      .mockResolvedValueOnce({ id: 'member-2', userId: 'other-user', role: 'AGENT', workspaceId: 'tenant-1' })
      .mockResolvedValueOnce({ role: 'OWNER' });

    await expect(
      service.editMember('tenant-1', 'member-2', 'actor-1', { role: 'SUPER_HACKER' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows an OWNER to promote an AGENT to MANAGER', async () => {
    const { service, prisma } = build();
    prisma.workspaceMember.findFirst
      .mockResolvedValueOnce({ id: 'member-2', userId: 'other-user', role: 'AGENT', workspaceId: 'tenant-1' })
      .mockResolvedValueOnce({ role: 'OWNER' });

    await service.editMember('tenant-1', 'member-2', 'actor-1', { role: 'MANAGER' });

    expect(prisma.workspaceMember.update).toHaveBeenCalledWith({
      where: { id: 'member-2' },
      data: { role: 'MANAGER' },
    });
  });

  it('still allows self-editing plain profile fields (name/phone/avatar)', async () => {
    const { service, prisma } = build();
    prisma.workspaceMember.findFirst.mockResolvedValueOnce({
      id: 'member-1', userId: 'actor-1', role: 'AGENT', workspaceId: 'tenant-1',
    });

    await service.editMember('tenant-1', 'member-1', 'actor-1', { name: 'New Name' });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'actor-1' },
      data: { name: 'New Name' },
    });
  });

  it('throws NotFoundException when the target member does not exist in this tenant', async () => {
    const { service, prisma } = build();
    prisma.workspaceMember.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.editMember('tenant-1', 'ghost-member', 'actor-1', { name: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });
});
