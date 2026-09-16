import axios, { AxiosError } from 'axios';
import { NotFoundException } from '@nestjs/common';
import { WhatsAppNumbersService } from './whatsapp-numbers.service';

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return { __esModule: true, ...actual, default: { ...actual.default, get: jest.fn() } };
});
const mockedGet = (axios as unknown as { get: jest.Mock }).get;

function metaError(status: number, message: string, code?: number): AxiosError {
  const err = new AxiosError(message);
  Object.assign(err, { response: { status, data: { error: { message, code } } } });
  return err;
}

function buildPrismaMock() {
  return {
    whatsAppNumber: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    channel: { findFirst: jest.fn(), create: jest.fn() },
    tenant: { update: jest.fn() },
  };
}

function buildDeps() {
  return {
    prisma: buildPrismaMock(),
    encryption: { encrypt: jest.fn((v: string) => `enc:${v}`), decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')) },
    audit: { log: jest.fn().mockResolvedValue(undefined) },
  };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new WhatsAppNumbersService(deps.prisma as any, deps.encryption as any, deps.audit as any);
}

describe('WhatsAppNumbersService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('status computation (findOne/findAll)', () => {
    it('reports CONNECTED for an active number with no recorded error', async () => {
      const deps = buildDeps();
      deps.prisma.whatsAppNumber.findFirst.mockResolvedValue({ id: 'n1', isActive: true, lastError: null });
      const service = buildService(deps);

      const num = await service.findOne('t1', 'n1');
      expect(num.status).toBe('CONNECTED');
    });

    it('reports NEEDS_ATTENTION for an active number with a recorded error', async () => {
      const deps = buildDeps();
      deps.prisma.whatsAppNumber.findFirst.mockResolvedValue({ id: 'n1', isActive: true, lastError: 'Authentication Error' });
      const service = buildService(deps);

      const num = await service.findOne('t1', 'n1');
      expect(num.status).toBe('NEEDS_ATTENTION');
    });

    it('reports DISCONNECTED for an inactive number regardless of lastError', async () => {
      const deps = buildDeps();
      deps.prisma.whatsAppNumber.findFirst.mockResolvedValue({ id: 'n1', isActive: false, lastError: 'Authentication Error' });
      const service = buildService(deps);

      const num = await service.findOne('t1', 'n1');
      expect(num.status).toBe('DISCONNECTED');
    });

    it('throws NotFoundException when the number does not exist for this tenant', async () => {
      const deps = buildDeps();
      deps.prisma.whatsAppNumber.findFirst.mockResolvedValue(null);
      const service = buildService(deps);

      await expect(service.findOne('t1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('reconnect', () => {
    it('forces isActive:true and clears lastError even when the caller sends no fields', async () => {
      const deps = buildDeps();
      deps.prisma.whatsAppNumber.findFirst.mockResolvedValue({ id: 'n1', tenantId: 't1', isActive: false, lastError: 'Authentication Error' });
      deps.prisma.whatsAppNumber.update.mockResolvedValue({ id: 'n1', isDefault: false, isActive: true, lastError: null });
      const service = buildService(deps);

      const result = await service.reconnect('t1', 'n1', {});

      expect(deps.prisma.whatsAppNumber.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'n1' },
        data: expect.objectContaining({ isActive: true, lastError: null, lastErrorAt: null }),
      }));
      expect(result.status).toBe('CONNECTED');
      expect(deps.audit.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ action: 'RECONNECT' }) }));
    });

    it('encrypts and applies a fresh accessToken when one is provided', async () => {
      const deps = buildDeps();
      deps.prisma.whatsAppNumber.findFirst.mockResolvedValue({ id: 'n1', tenantId: 't1', isActive: false, lastError: 'Authentication Error' });
      deps.prisma.whatsAppNumber.update.mockResolvedValue({ id: 'n1', isDefault: false, isActive: true, lastError: null });
      const service = buildService(deps);

      await service.reconnect('t1', 'n1', { accessToken: 'fresh-token' });

      expect(deps.encryption.encrypt).toHaveBeenCalledWith('fresh-token');
      expect(deps.prisma.whatsAppNumber.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ accessToken: 'enc:fresh-token' }),
      }));
    });

    it('syncs Tenant when reconnecting the default number with a fresh token', async () => {
      const deps = buildDeps();
      deps.prisma.whatsAppNumber.findFirst.mockResolvedValue({ id: 'n1', tenantId: 't1', isActive: false, lastError: 'x' });
      deps.prisma.whatsAppNumber.update.mockResolvedValue({ id: 'n1', isDefault: true, isActive: true, lastError: null });
      deps.prisma.whatsAppNumber.findUniqueOrThrow.mockResolvedValue({ id: 'n1', phoneNumberId: 'pn-1', wabaId: 'waba-1', accessToken: 'enc:fresh-token' });
      const service = buildService(deps);

      await service.reconnect('t1', 'n1', { accessToken: 'fresh-token' });

      expect(deps.prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 't1' },
        data: { phoneNumberId: 'pn-1', wabaId: 'waba-1', accessToken: 'fresh-token' },
      }));
    });

    it('restores isDefault when disconnecting this number left the tenant with no active default at all', async () => {
      // Regression test: remove() clears isDefault on disconnect and only
      // promotes a DIFFERENT number to default when one exists -- it never
      // un-disconnects this row. A prior version of reconnect() never put
      // isDefault back, so a tenant with only one number could disconnect
      // and reconnect it and be left with zero default numbers, leaving
      // Tenant's legacy fallback fields permanently stale (the same class
      // of bug as the 2026-09-16 incident).
      const deps = buildDeps();
      deps.prisma.whatsAppNumber.findFirst
        .mockResolvedValueOnce({ id: 'n1', tenantId: 't1', isActive: false, lastError: null }) // findOne() existence check
        .mockResolvedValueOnce(null); // no active default exists anywhere for this tenant
      deps.prisma.whatsAppNumber.update.mockResolvedValue({ id: 'n1', isDefault: true, isActive: true, lastError: null });
      deps.prisma.whatsAppNumber.findUniqueOrThrow.mockResolvedValue({ id: 'n1', phoneNumberId: 'pn-1', wabaId: 'waba-1', accessToken: 'enc:recovered-token' });
      const service = buildService(deps);

      await service.reconnect('t1', 'n1', { accessToken: 'recovered-token' });

      expect(deps.prisma.whatsAppNumber.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ isDefault: true }),
      }));
      expect(deps.prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { phoneNumberId: 'pn-1', wabaId: 'waba-1', accessToken: 'recovered-token' },
      }));
    });

    it('does not steal default status back when the tenant already has a different active default', async () => {
      const deps = buildDeps();
      deps.prisma.whatsAppNumber.findFirst
        .mockResolvedValueOnce({ id: 'n1', tenantId: 't1', isActive: false, lastError: null })
        .mockResolvedValueOnce({ id: 'n2', tenantId: 't1', isDefault: true, isActive: true }); // a different number is already default
      deps.prisma.whatsAppNumber.update.mockResolvedValue({ id: 'n1', isDefault: false, isActive: true, lastError: null });
      const service = buildService(deps);

      await service.reconnect('t1', 'n1', { accessToken: 'recovered-token' });

      expect(deps.prisma.whatsAppNumber.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.not.objectContaining({ isDefault: true }),
      }));
    });
  });

  describe('testConnection', () => {
    it('clears lastError and returns success on a valid Graph API response', async () => {
      const deps = buildDeps();
      deps.prisma.whatsAppNumber.findFirst.mockResolvedValue({ id: 'n1', tenantId: 't1', phoneNumberId: 'pn-1', accessToken: 'enc:real-token' });
      mockedGet.mockResolvedValue({ data: { verified_name: 'Acme' } });
      const service = buildService(deps);

      const result = await service.testConnection('t1', 'n1');

      expect(result).toEqual({ success: true });
      expect(mockedGet).toHaveBeenCalledWith(
        expect.stringContaining('/pn-1'),
        expect.objectContaining({ headers: { Authorization: 'Bearer real-token' } }),
      );
      expect(deps.prisma.whatsAppNumber.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { lastError: null, lastErrorAt: null } });
    });

    it('records a friendly error and category when Meta rejects the token', async () => {
      const deps = buildDeps();
      deps.prisma.whatsAppNumber.findFirst.mockResolvedValue({ id: 'n1', tenantId: 't1', phoneNumberId: 'pn-1', accessToken: 'enc:bad-token' });
      mockedGet.mockRejectedValue(metaError(401, 'Error validating access token', 190));
      const service = buildService(deps);

      const result = await service.testConnection('t1', 'n1');

      expect(result.success).toBe(false);
      expect(result).toMatchObject({ error: 'Error validating access token', category: 'account_restricted' });
      expect(deps.prisma.whatsAppNumber.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { lastError: 'Error validating access token', lastErrorAt: expect.any(Date) },
      });
    });

    it('throws NotFoundException for a number that does not belong to this tenant', async () => {
      const deps = buildDeps();
      deps.prisma.whatsAppNumber.findFirst.mockResolvedValue(null);
      const service = buildService(deps);

      await expect(service.testConnection('t1', 'not-mine')).rejects.toThrow(NotFoundException);
      expect(mockedGet).not.toHaveBeenCalled();
    });
  });
});
