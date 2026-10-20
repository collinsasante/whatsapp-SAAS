import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';

function build(inviter: { role: string } | null, legacy: { role: string } | null = null) {
  const prisma = {
    workspaceMember: { findFirst: jest.fn().mockResolvedValueOnce(inviter).mockResolvedValue(null) },
    user: { findFirst: jest.fn().mockResolvedValue(legacy) },
    workspaceInvitation: { deleteMany: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}) },
  };
  const configService = { get: jest.fn().mockReturnValue('http://localhost:3000') };
  const auditService = { log: jest.fn().mockResolvedValue(undefined) };
  const emailService = { sendInvitation: jest.fn().mockResolvedValue(undefined) };
  const service = new WorkspaceService(prisma as never, configService as never, auditService as never, {} as never, emailService as never);
  return { service, prisma, auditService };
}

describe('WorkspaceService.createInvitation -- who can invite which role', () => {
  it('an Admin cannot invite an Owner (privilege escalation)', async () => {
    const { service, prisma } = build({ role: 'ADMIN' });
    await expect(service.createInvitation('t1', 'admin-1', 'new@acme.test', 'OWNER')).rejects.toThrow(ForbiddenException);
    expect(prisma.workspaceInvitation.create).not.toHaveBeenCalled();
  });

  it.each([['ADMIN', 'OWNER'], ['MANAGER', 'ADMIN'], ['AGENT', 'MANAGER'], ['VIEWER', 'AGENT']])('%s cannot invite %s', async (inviterRole, invited) => {
    const { service, prisma } = build({ role: inviterRole });
    await expect(service.createInvitation('t1', 'actor', 'new@acme.test', invited)).rejects.toThrow(ForbiddenException);
    expect(prisma.workspaceInvitation.create).not.toHaveBeenCalled();
  });

  it.each([['OWNER', 'OWNER'], ['OWNER', 'AGENT'], ['ADMIN', 'ADMIN'], ['ADMIN', 'AGENT'], ['MANAGER', 'AGENT']])('%s can invite %s, and the invitation stores exactly that role', async (inviterRole, invited) => {
    const { service, prisma } = build({ role: inviterRole });
    await service.createInvitation('t1', 'actor', 'new@acme.test', invited);
    expect(prisma.workspaceInvitation.create.mock.calls[0][0].data).toMatchObject({ workspaceId: 't1', email: 'new@acme.test', role: invited });
  });

  it('an older account with no membership row falls back to its legacy role instead of being locked out', async () => {
    const { service } = build(null, { role: 'ADMIN' });
    await expect(service.createInvitation('t1', 'legacy-admin', 'a@acme.test', 'AGENT')).resolves.toBeDefined();
    const denied = build(null, { role: 'ADMIN' });
    await expect(denied.service.createInvitation('t1', 'legacy-admin', 'a@acme.test', 'OWNER')).rejects.toThrow(ForbiddenException);
  });

  it('an account with neither a membership nor a user in this workspace can invite nobody above a viewer', async () => {
    const { service } = build(null, null);
    await expect(service.createInvitation('t1', 'ghost', 'a@acme.test', 'AGENT')).rejects.toThrow(ForbiddenException);
  });

  it('rejects an invalid role name before any lookup', async () => {
    const { service, prisma } = build({ role: 'OWNER' });
    await expect(service.createInvitation('t1', 'o', 'a@acme.test', 'SUPER_ADMIN')).rejects.toThrow(BadRequestException);
    expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled();
  });
});
