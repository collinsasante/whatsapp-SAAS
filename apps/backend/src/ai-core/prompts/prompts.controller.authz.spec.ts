import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PlatformAdminGuard } from '../../platform-admin/platform-admin.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { PromptsController } from './prompts.controller';

/**
 * Global prompts decide what every workspace's AI says. These tests run the REAL guard against the REAL route metadata of
 * PromptsController, so removing or weakening a role requirement on a route fails here.
 */
const proto = PromptsController.prototype;
const READ_ROUTES = { listTemplates: proto.listTemplates, listVersions: proto.listVersions };
const WRITE_ROUTES = { createVersion: proto.createVersion, activate: proto.activate };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function contextFor(handler: (...args: any[]) => unknown): ExecutionContext {
  const request = { headers: { authorization: 'Bearer admin-token' } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => PromptsController,
  } as unknown as ExecutionContext;
}

describe('PromptsController authorisation', () => {
  const jwt = { verify: jest.fn() };
  const prisma = { platformAdmin: { findUnique: jest.fn() } };
  const guard = new PlatformAdminGuard(jwt as unknown as JwtService, { get: () => 'secret' } as unknown as ConfigService, new Reflector(), prisma as unknown as PrismaService);
  const signedInAs = (dbRole: string | null, isActive = true, tokenRole = 'platform_admin') => {
    jwt.verify.mockReturnValue({ sub: 'admin-1', role: tokenRole });
    prisma.platformAdmin.findUnique.mockResolvedValue(dbRole === null ? null : { isActive, role: dbRole });
  };

  beforeEach(() => jest.clearAllMocks());

  describe.each(Object.entries(WRITE_ROUTES))('%s (changes every workspace)', (_name, handler) => {
    it('allows SUPER_ADMIN', async () => {
      signedInAs('SUPER_ADMIN');
      await expect(guard.canActivate(contextFor(handler))).resolves.toBe(true);
    });

    it.each(['SUPPORT', 'VIEWER'])('refuses %s with 403', async (role) => {
      signedInAs(role);
      await expect(guard.canActivate(contextFor(handler))).rejects.toThrow(ForbiddenException);
    });

    it('refuses a role the system does not know (it is treated as VIEWER)', async () => {
      signedInAs('AUDITOR');
      await expect(guard.canActivate(contextFor(handler))).rejects.toThrow(ForbiddenException);
    });

    it('refuses a SUPER_ADMIN whose account has been switched off', async () => {
      signedInAs('SUPER_ADMIN', false);
      await expect(guard.canActivate(contextFor(handler))).rejects.toThrow(UnauthorizedException);
    });

    it('refuses a token whose admin no longer exists', async () => {
      signedInAs(null);
      await expect(guard.canActivate(contextFor(handler))).rejects.toThrow(UnauthorizedException);
    });

    it('refuses a valid tenant-user token (not a platform-admin token)', async () => {
      signedInAs('SUPER_ADMIN', true, 'ADMIN');
      await expect(guard.canActivate(contextFor(handler))).rejects.toThrow(ForbiddenException);
    });
  });

  describe.each(Object.entries(READ_ROUTES))('%s (read only)', (_name, handler) => {
    it.each(['SUPER_ADMIN', 'SUPPORT', 'VIEWER'])('stays open to %s', async (role) => {
      signedInAs(role);
      await expect(guard.canActivate(contextFor(handler))).resolves.toBe(true);
    });
  });
});
