import axios from 'axios';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { WhatsAppWebService } from './whatsapp-web.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function buildDeps() {
  return {
    prisma: {
      channel: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'chan1' }),
        update: jest.fn().mockResolvedValue({ id: 'chan1' }),
        delete: jest.fn().mockResolvedValue({ id: 'chan1' }),
      },
      whatsAppWebSession: {
        create: jest.fn().mockResolvedValue({ id: 'sess1' }),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'sess1' }),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    },
    config: { get: jest.fn((_key: string, fallback?: string) => fallback) },
    realtime: { emitWhatsAppWebQr: jest.fn(), emitWhatsAppWebStatus: jest.fn() },
    audit: { log: jest.fn().mockResolvedValue(undefined) },
    messagesService: { handleInboundWhatsAppWeb: jest.fn().mockResolvedValue({ id: 'msg1' }) },
  };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  return new WhatsAppWebService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deps.prisma as any, deps.config as any, deps.realtime as any, deps.audit as any, deps.messagesService as any,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('WhatsAppWebService.startPairing', () => {
  it('creates a Channel + WhatsAppWebSession and tells the session-manager to start a real Baileys connection', async () => {
    const deps = buildDeps();
    mockedAxios.request.mockResolvedValue({ data: { ok: true } });
    const service = buildService(deps);

    const result = await service.startPairing('t1', 'user1', 'My WhatsApp');

    expect(deps.prisma.channel.create).toHaveBeenCalledWith({
      data: { tenantId: 't1', type: ChannelType.WHATSAPP_WEB, name: 'My WhatsApp', isActive: true },
    });
    expect(mockedAxios.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'post', url: expect.stringContaining('/sessions'),
      data: { sessionId: 'sess1', tenantId: 't1', channelId: 'chan1' },
    }));
    expect(result).toEqual({ channelId: 'chan1', sessionId: 'sess1' });
  });

  it('disambiguates a duplicate channel name the same way OAuth channels already do, rather than letting the unique constraint fail', async () => {
    const deps = buildDeps();
    deps.prisma.channel.findFirst
      .mockResolvedValueOnce({ id: 'existing' }) // "WhatsApp Web" taken
      .mockResolvedValueOnce(null); // "WhatsApp Web 2" free
    mockedAxios.request.mockResolvedValue({ data: { ok: true } });
    const service = buildService(deps);

    await service.startPairing('t1', 'user1');

    expect(deps.prisma.channel.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'WhatsApp Web 2' }),
    }));
  });

  it('rolls back the Channel row if the session-manager is unreachable, instead of leaving a permanently-broken QR_PENDING channel', async () => {
    const deps = buildDeps();
    mockedAxios.request.mockRejectedValue(new Error('ECONNREFUSED'));
    const service = buildService(deps);

    await expect(service.startPairing('t1', 'user1')).rejects.toThrow(BadRequestException);
    expect(deps.prisma.channel.delete).toHaveBeenCalledWith({ where: { id: 'chan1' } });
  });
});

describe('WhatsAppWebService tenant isolation', () => {
  it('getSessionStatus scopes the lookup to the calling tenant -- another tenant\'s session ID resolves to not-found, not their data', async () => {
    const deps = buildDeps();
    deps.prisma.whatsAppWebSession.findFirst.mockResolvedValue(null); // scoped query finds nothing for a foreign tenant
    const service = buildService(deps);

    await expect(service.getSessionStatus('tenant-a', 'sess-owned-by-tenant-b')).rejects.toThrow(NotFoundException);
    expect(deps.prisma.whatsAppWebSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'sess-owned-by-tenant-b', tenantId: 'tenant-a' },
    });
  });

  it('disconnectSession is tenant-scoped the same way', async () => {
    const deps = buildDeps();
    deps.prisma.whatsAppWebSession.findFirst.mockResolvedValue(null);
    const service = buildService(deps);

    await expect(service.disconnectSession('tenant-a', 'sess-owned-by-tenant-b')).rejects.toThrow(NotFoundException);
  });

  it('logoutSession is tenant-scoped the same way', async () => {
    const deps = buildDeps();
    deps.prisma.whatsAppWebSession.findFirst.mockResolvedValue(null);
    const service = buildService(deps);

    await expect(service.logoutSession('tenant-a', 'sess-owned-by-tenant-b')).rejects.toThrow(NotFoundException);
  });
});

describe('WhatsAppWebService.sendText', () => {
  it('refuses to send when the session is not CONNECTED', async () => {
    const deps = buildDeps();
    deps.prisma.whatsAppWebSession.findFirst.mockResolvedValue({ id: 'sess1', status: 'RECONNECTING' });
    const service = buildService(deps);

    await expect(service.sendText('t1', 'chan1', '+233555000111', 'hi')).rejects.toThrow(BadRequestException);
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it('sends through the session-manager when CONNECTED', async () => {
    const deps = buildDeps();
    deps.prisma.whatsAppWebSession.findFirst.mockResolvedValue({ id: 'sess1', status: 'CONNECTED' });
    mockedAxios.request.mockResolvedValue({ data: { providerMessageId: 'wamid.123' } });
    const service = buildService(deps);

    const id = await service.sendText('t1', 'chan1', '+233555000111', 'hi');

    expect(id).toBe('wamid.123');
    expect(mockedAxios.request).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('/sessions/sess1/send-text'),
      data: { toPhone: '+233555000111', text: 'hi' },
    }));
  });
});

describe('WhatsAppWebService.handleInternalEvent', () => {
  it('qr event: forwards the QR straight to realtime, no DB write', async () => {
    const deps = buildDeps();
    const service = buildService(deps);

    await service.handleInternalEvent({ type: 'qr', tenantId: 't1', sessionId: 'sess1', channelId: 'chan1', qrDataUrl: 'data:image/png;base64,...' });

    expect(deps.realtime.emitWhatsAppWebQr).toHaveBeenCalledWith('t1', 'sess1', 'chan1', 'data:image/png;base64,...');
    expect(deps.prisma.whatsAppWebSession.update).not.toHaveBeenCalled();
  });

  it('status event: persists the new status and backfills Channel.externalId the first time a phone number is reported', async () => {
    const deps = buildDeps();
    const service = buildService(deps);

    await service.handleInternalEvent({ type: 'status', tenantId: 't1', sessionId: 'sess1', channelId: 'chan1', status: 'CONNECTED', phoneNumber: '+233 55 500 0111' });

    expect(deps.prisma.whatsAppWebSession.update).toHaveBeenCalledWith({
      where: { id: 'sess1' }, data: { status: 'CONNECTED', phoneNumber: '+233 55 500 0111' },
    });
    expect(deps.prisma.channel.update).toHaveBeenCalledWith({ where: { id: 'chan1' }, data: { externalId: '+233555000111' } });
    expect(deps.realtime.emitWhatsAppWebStatus).toHaveBeenCalledWith('t1', 'sess1', 'chan1', 'CONNECTED', '+233 55 500 0111');
  });

  it('inbound_message event: drops a malformed payload (missing providerMessageId) rather than crashing or forwarding garbage', async () => {
    const deps = buildDeps();
    const service = buildService(deps);

    await service.handleInternalEvent({ type: 'inbound_message', tenantId: 't1', channelId: 'chan1', fromPhone: '+233555000111' });

    expect(deps.messagesService.handleInboundWhatsAppWeb).not.toHaveBeenCalled();
  });

  it('inbound_message event: forwards a well-formed payload into the existing message pipeline', async () => {
    const deps = buildDeps();
    const service = buildService(deps);

    await service.handleInternalEvent({
      type: 'inbound_message', tenantId: 't1', channelId: 'chan1',
      fromPhone: '+233555000111', providerMessageId: 'wa-msg-1', content: 'hi', pushName: 'Jane',
    });

    expect(deps.messagesService.handleInboundWhatsAppWeb).toHaveBeenCalledWith(
      't1', 'chan1', '+233555000111', 'wa-msg-1',
      { content: 'hi', mediaType: undefined, mediaBase64: undefined, mimetype: undefined, caption: undefined },
      'Jane',
    );
  });
});
