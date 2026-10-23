import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { FacebookMessengerService } from './facebook-messenger.service';
import { MessengerWebhookController } from './messenger.webhook.controller';

const TOKEN = 'IGPAGE-secret-token';

function buildSender(channel: object | null = { isActive: true, credentials: { accessToken: `enc:${TOKEN}`, igAccountId: 'ig-1' } }) {
  const prisma = { channel: { findFirst: jest.fn().mockResolvedValue(channel) } };
  const encryption = { decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')) };
  return { service: new FacebookMessengerService(prisma as never, encryption as never), prisma };
}

describe('FacebookMessengerService: Instagram sending', () => {
  let post: jest.SpyInstance;
  beforeEach(() => { post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { message_id: 'mid.out1' } }); });
  afterEach(() => jest.restoreAllMocks());

  it('sends text to /me/messages with the decrypted Page token, and the token travels as a query parameter only', async () => {
    const { service, prisma } = buildSender();

    await expect(service.sendInstagramTextMessage('t1', 'ch1', 'IGSID-9', 'hello')).resolves.toBe('mid.out1');

    expect(prisma.channel.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ch1', tenantId: 't1', type: 'INSTAGRAM' } }));
    const [url, body, config] = post.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v19.0/me/messages');
    expect(body).toEqual({ recipient: { id: 'IGSID-9' }, message: { text: 'hello' } });
    expect(config).toEqual({ params: { access_token: TOKEN } });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("will not use another workspace's channel or a non-Instagram channel (the lookup is keyed by tenant and type)", async () => {
    const { service } = buildSender(null);
    await expect(service.sendInstagramTextMessage('tenant-B', 'ch-of-A', 'IGSID-9', 'hi')).rejects.toThrow('not connected');
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses a disconnected account without calling Meta', async () => {
    const { service } = buildSender({ isActive: false, credentials: { accessToken: 'enc:x' } });
    await expect(service.sendInstagramTextMessage('t1', 'ch1', 'IGSID-9', 'hi')).rejects.toThrow('disconnected');
    expect(post).not.toHaveBeenCalled();
  });

  it('asks for a reconnect when no token is stored', async () => {
    const { service } = buildSender({ isActive: true, credentials: {} });
    await expect(service.sendInstagramTextMessage('t1', 'ch1', 'IGSID-9', 'hi')).rejects.toThrow('reconnected');
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses text over the 1,000-character limit before calling Meta, and allows exactly 1,000', async () => {
    const { service } = buildSender();
    await expect(service.sendInstagramTextMessage('t1', 'ch1', 'IGSID-9', 'x'.repeat(1001))).rejects.toBeInstanceOf(BadRequestException);
    expect(post).not.toHaveBeenCalled();
    await expect(service.sendInstagramTextMessage('t1', 'ch1', 'IGSID-9', 'x'.repeat(1000))).resolves.toBe('mid.out1');
  });

  it("surfaces Meta's reason, never the token", async () => {
    post.mockRejectedValue(Object.assign(new Error('Request failed'), { isAxiosError: true, response: { data: { error: { message: 'Outside of allowed window' } } } }));
    const { service } = buildSender();
    const err = await service.sendInstagramTextMessage('t1', 'ch1', 'IGSID-9', 'hi').catch((e: Error) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain('Failed to send message');
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it.each(['image', 'video', 'audio'])('sends %s as an attachment, with the caption as a follow-up text', async (type) => {
    const { service } = buildSender();
    await service.sendInstagramMediaMessage('t1', 'ch1', 'IGSID-9', type, 'https://cdn.example.com/f', 'look');
    expect(post.mock.calls[0][1]).toEqual({ recipient: { id: 'IGSID-9' }, message: { attachment: { type, payload: { url: 'https://cdn.example.com/f' } } } });
    expect(post.mock.calls[1][1]).toEqual({ recipient: { id: 'IGSID-9' }, message: { text: 'look' } });
  });

  it.each(['document', 'file', 'sticker'])('refuses %s (Instagram has no document sending) without calling Meta', async (type) => {
    const { service } = buildSender();
    await expect(service.sendInstagramMediaMessage('t1', 'ch1', 'IGSID-9', type, 'https://cdn.example.com/f')).rejects.toThrow('only supports');
    expect(post).not.toHaveBeenCalled();
  });
});

describe('MessengerWebhookController: Instagram events', () => {
  function build(channels: object[] = [{ id: 'ch-ig', tenantId: 't1', externalId: 'ig-1' }]) {
    const prisma = { channel: { findMany: jest.fn().mockResolvedValue(channels) } };
    const messages = { handleInboundMessenger: jest.fn().mockResolvedValue({}) };
    const events = { recordReceived: jest.fn().mockResolvedValue('ev1'), markOutcome: jest.fn().mockResolvedValue(undefined) };
    const controller = new MessengerWebhookController(prisma as never, messages as never, events as never);
    return { controller, prisma, messages, events };
  }
  const receive = (c: MessengerWebhookController, body: unknown) => c.receive({ rawBody: Buffer.from('{}') } as never, body as never, 'sha256=x');
  const igEntry = (messaging: object[], id = 'ig-1') => ({ object: 'instagram', entry: [{ id, time: 1, messaging }] });
  const event = (message: object) => ({ sender: { id: 'IGSID-9' }, recipient: { id: 'ig-1' }, timestamp: 1, message });

  const savedSecret = process.env['FACEBOOK_APP_SECRET'];
  beforeEach(() => { delete process.env['FACEBOOK_APP_SECRET']; });
  afterEach(() => { if (savedSecret === undefined) delete process.env['FACEBOOK_APP_SECRET']; else process.env['FACEBOOK_APP_SECRET'] = savedSecret; });

  it('routes an Instagram message to the active INSTAGRAM channel with that account id, as an Instagram message', async () => {
    const { controller, prisma, messages, events } = build();
    await receive(controller, igEntry([event({ mid: 'm1', text: 'hi' })]));

    expect(prisma.channel.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { type: 'INSTAGRAM', externalId: { in: ['ig-1'] }, isActive: true, tenant: { isActive: true } },
    }));
    expect(messages.handleInboundMessenger).toHaveBeenCalledWith('t1', 'ch-ig', 'IGSID-9', { mid: 'm1', text: 'hi' }, 'INSTAGRAM');
    expect(events.recordReceived).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'instagram_messaging', tenantId: 't1' }));
  });

  it("ignores the account's own echoed messages", async () => {
    const { controller, messages } = build();
    await receive(controller, igEntry([event({ mid: 'm2', text: 'ours', is_echo: true })]));
    expect(messages.handleInboundMessenger).not.toHaveBeenCalled();
  });

  it('does nothing for an Instagram account that is not connected or is disconnected', async () => {
    const { controller, messages } = build([]);
    await expect(receive(controller, igEntry([event({ mid: 'm3', text: 'hi' })], 'ig-unknown'))).resolves.toEqual({ status: 'ok' });
    expect(messages.handleInboundMessenger).not.toHaveBeenCalled();
  });

  it('keeps routing Page (Messenger) events to FACEBOOK_MESSENGER channels as before', async () => {
    const { controller, prisma, messages } = build([{ id: 'ch-fb', tenantId: 't1', externalId: 'page-1' }]);
    await receive(controller, { object: 'page', entry: [{ id: 'page-1', time: 1, messaging: [event({ mid: 'm4', text: 'hey' })] }] });
    expect(prisma.channel.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ type: 'FACEBOOK_MESSENGER' }) }));
    expect(messages.handleInboundMessenger).toHaveBeenCalledWith('t1', 'ch-fb', 'IGSID-9', { mid: 'm4', text: 'hey' }, 'MESSENGER');
  });

  it('ignores any other webhook object', async () => {
    const { controller, prisma } = build();
    await expect(receive(controller, { object: 'whatsapp_business_account', entry: [{ id: 'x' }] })).resolves.toEqual({ status: 'ok' });
    expect(prisma.channel.findMany).not.toHaveBeenCalled();
  });

  it('still rejects an invalid signature when the app secret is configured', async () => {
    process.env['FACEBOOK_APP_SECRET'] = 'real-secret';
    const { controller, messages } = build();
    await expect(receive(controller, igEntry([event({ mid: 'm5', text: 'forged' })]))).rejects.toBeInstanceOf(BadRequestException);
    expect(messages.handleInboundMessenger).not.toHaveBeenCalled();
  });
});
