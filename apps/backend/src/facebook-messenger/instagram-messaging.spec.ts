import { BadRequestException } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
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

describe('FacebookMessengerService.fetchContactName', () => {
  afterEach(() => jest.restoreAllMocks());

  function buildBoth() {
    const prisma = {
      channel: { findFirst: jest.fn().mockResolvedValue({ isActive: true, credentials: { accessToken: `enc:${TOKEN}` } }) },
      facebookPageConnection: { findFirst: jest.fn().mockResolvedValue({ isActive: true, pageAccessToken: `enc:${TOKEN}` }) },
    };
    return { service: new FacebookMessengerService(prisma as never, { decrypt: (v: string) => v.replace(/^enc:/, '') } as never), prisma };
  }

  it('Messenger: reads the name with the Page token and asks only for name fields', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { name: 'Ama Mensah' } });
    const { service } = buildBoth();
    await expect(service.fetchContactName('t1', 'ch1', 'MESSENGER', 'PSID-1')).resolves.toEqual({ name: 'Ama Mensah' });
    expect(get.mock.calls[0][0]).toBe('https://graph.facebook.com/v19.0/PSID-1');
    expect(get.mock.calls[0][1]).toMatchObject({ params: { fields: 'name,first_name,last_name', access_token: TOKEN } });
  });

  it('Messenger: builds the name from first and last name when there is no name field', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: { first_name: 'Kofi', last_name: 'Boateng' } });
    const { service } = buildBoth();
    await expect(service.fetchContactName('t1', 'ch1', 'MESSENGER', 'PSID-1')).resolves.toEqual({ name: 'Kofi Boateng' });
  });

  it('Instagram: uses the account token, and falls back to @username', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { username: 'glam_pack' } });
    const { service, prisma } = buildBoth();
    await expect(service.fetchContactName('t1', 'ch-ig', 'INSTAGRAM', 'IGSID-1')).resolves.toEqual({ name: '@glam_pack' });
    expect(get.mock.calls[0][1]).toMatchObject({ params: { fields: 'name,username' } });
    expect(prisma.channel.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ch-ig', tenantId: 't1', type: 'INSTAGRAM' } }));
  });

  it('falls back to the conversation list when the profile is refused, and finds the person by id', async () => {
    const get = jest.spyOn(axios, 'get')
      .mockRejectedValueOnce(new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, { data: { error: { message: 'Unsupported get request' } } } as never))
      .mockResolvedValueOnce({ data: { data: [{ participants: { data: [{ id: 'PAGE', name: 'Our Page' }, { id: 'PSID-1', name: 'Ama Mensah' }] } }] } });
    const { service } = buildBoth();
    await expect(service.fetchContactName('t1', 'ch1', 'MESSENGER', 'PSID-1')).resolves.toEqual({ name: 'Ama Mensah' });
    expect(get.mock.calls[1][0]).toBe('https://graph.facebook.com/v19.0/me/conversations');
    expect(get.mock.calls[1][1]).toMatchObject({ params: { fields: 'participants', user_id: 'PSID-1', access_token: TOKEN } });
    expect((get.mock.calls[1][1] as { params: Record<string, unknown> }).params).not.toHaveProperty('platform');
  });

  it('Instagram fallback asks for the instagram platform and uses @username when there is no name', async () => {
    const get = jest.spyOn(axios, 'get')
      .mockRejectedValueOnce(new Error('profile down'))
      .mockResolvedValueOnce({ data: { data: [{ participants: { data: [{ id: 'IGSID-1', username: 'glam_pack' }] } }] } });
    const { service } = buildBoth();
    await expect(service.fetchContactName('t1', 'ch-ig', 'INSTAGRAM', 'IGSID-1')).resolves.toEqual({ name: '@glam_pack' });
    expect(get.mock.calls[1][1]).toMatchObject({ params: { platform: 'instagram', user_id: 'IGSID-1' } });
  });

  it('never picks someone else: a conversation without that person gives no name, with both reasons logged', async () => {
    jest.spyOn(axios, 'get')
      .mockRejectedValueOnce(new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, { data: { error: { message: 'profile refused' } } } as never))
      .mockResolvedValueOnce({ data: { data: [{ participants: { data: [{ id: 'SOMEONE-ELSE', name: 'Wrong Person' }] } }] } });
    const { service } = buildBoth();
    const r = await service.fetchContactName('t1', 'ch1', 'MESSENGER', 'PSID-1');
    expect(r.name).toBeNull();
    expect(r.reason).toBe('profile: profile refused | conversations: the person was not listed');
    expect(JSON.stringify(r)).not.toContain('Wrong Person');
  });

  it('does not call the conversation list when the profile already gave a name', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { name: 'Ama Mensah' } });
    const { service } = buildBoth();
    await service.fetchContactName('t1', 'ch1', 'MESSENGER', 'PSID-1');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('never throws: returns the reason when Meta refuses, and no token in it', async () => {
    jest.spyOn(axios, 'get').mockRejectedValue(new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, { data: { error: { message: '(#10) Application does not have permission' } } } as never));
    const { service } = buildBoth();
    const r = await service.fetchContactName('t1', 'ch1', 'MESSENGER', 'PSID-1');
    expect(r.name).toBeNull();
    expect(r.reason).toContain('profile:');
    expect(r.reason).toContain('conversations:');
    expect(r.reason).toContain('permission');
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it('never throws when the account is disconnected', async () => {
    const prisma = { channel: { findFirst: jest.fn().mockResolvedValue({ isActive: false, credentials: {} }) } };
    const service = new FacebookMessengerService(prisma as never, { decrypt: (v: string) => v } as never);
    const r = await service.fetchContactName('t1', 'ch-ig', 'INSTAGRAM', 'IGSID-1');
    expect(r.name).toBeNull();
    expect(r.reason).toContain('disconnected');
  });
});

describe('MessengerWebhookController: Instagram events', () => {
  function build(channels: object[] = [{ id: 'ch-ig', tenantId: 't1', externalId: 'ig-1' }]) {
    const prisma = { channel: { findMany: jest.fn().mockResolvedValue(channels) } };
    const messages = { handleInboundMessenger: jest.fn().mockResolvedValue({}), handleMetaReceipt: jest.fn().mockResolvedValue(undefined) };
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

  it('applies delivered and read receipts for Instagram and Messenger, and a failure never fails the webhook', async () => {
    const { controller, messages } = build();
    await receive(controller, igEntry([
      { sender: { id: 'IGSID-9' }, recipient: { id: 'ig-1' }, timestamp: 1, read: { mid: 'mid.seen' } },
      { sender: { id: 'IGSID-9' }, recipient: { id: 'ig-1' }, timestamp: 2, delivery: { mids: ['mid.d1'] } },
    ]));
    expect(messages.handleMetaReceipt).toHaveBeenCalledWith('t1', 'ch-ig', 'IGSID-9', 'INSTAGRAM', 'READ', { mid: 'mid.seen' });
    expect(messages.handleMetaReceipt).toHaveBeenCalledWith('t1', 'ch-ig', 'IGSID-9', 'INSTAGRAM', 'DELIVERED', { mids: ['mid.d1'] });

    messages.handleMetaReceipt.mockRejectedValue(new Error('db down'));
    await expect(receive(controller, igEntry([{ sender: { id: 'IGSID-9' }, recipient: { id: 'ig-1' }, timestamp: 3, read: { watermark: 5 } }]))).resolves.toEqual({ status: 'ok' });
  });

  it('a receipt is not treated as an inbound message', async () => {
    const { controller, messages } = build();
    await receive(controller, igEntry([{ sender: { id: 'IGSID-9' }, recipient: { id: 'ig-1' }, timestamp: 1, read: { watermark: 5 } }]));
    expect(messages.handleInboundMessenger).not.toHaveBeenCalled();
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

describe('FacebookMessengerService: files uploaded to Meta and quoted replies', () => {
  afterEach(() => jest.restoreAllMocks());
  const file = { buffer: Buffer.from('FILEBYTES'), mimeType: 'image/jpeg', filename: 'file.jpeg' };

  function both() {
    const prisma = {
      channel: { findFirst: jest.fn().mockResolvedValue({ isActive: true, credentials: { accessToken: `enc:${TOKEN}` } }) },
      facebookPageConnection: { findFirst: jest.fn().mockResolvedValue({ isActive: true, pageAccessToken: `enc:${TOKEN}` }) },
    };
    return new FacebookMessengerService(prisma as never, { decrypt: (v: string) => v.replace(/^enc:/, '') } as never);
  }
  const callsTo = (post: jest.SpyInstance, fragment: string) => post.mock.calls.filter((c) => String(c[0]).includes(fragment));

  it.each(['MESSENGER', 'INSTAGRAM'] as const)('%s: uploads the file to Meta and sends it by attachment id, not by link', async (platform) => {
    const post = jest.spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { attachment_id: 'att-1' } })
      .mockResolvedValueOnce({ data: { message_id: 'mid.out' } });
    const service = both();

    const id = platform === 'MESSENGER'
      ? await service.sendMediaMessage('t1', 'ch', 'PSID', 'image', 'https://our.server/f.jpg', undefined, { file })
      : await service.sendInstagramMediaMessage('t1', 'ch', 'IGSID', 'image', 'https://our.server/f.jpg', undefined, { file });

    expect(id).toBe('mid.out');
    expect(post.mock.calls[0][0]).toBe('https://graph.facebook.com/v19.0/me/message_attachments');
    expect(post.mock.calls[0][1]).toBeInstanceOf(FormData);
    expect(post.mock.calls[0][2]).toMatchObject({ params: { access_token: TOKEN } });
    const sent = post.mock.calls[1][1] as { message: { attachment: { type: string; payload: Record<string, unknown> } } };
    expect(sent.message.attachment.payload).toEqual({ attachment_id: 'att-1' });
    expect(JSON.stringify(sent)).not.toContain('our.server');
  });

  it('falls back to sending the link when the upload to Meta fails', async () => {
    const post = jest.spyOn(axios, 'post')
      .mockRejectedValueOnce(new Error('upload down'))
      .mockResolvedValueOnce({ data: { message_id: 'mid.out' } });
    await expect(both().sendInstagramMediaMessage('t1', 'ch', 'IGSID', 'image', 'https://our.server/f.jpg', undefined, { file })).resolves.toBe('mid.out');
    expect((post.mock.calls[1][1] as { message: { attachment: { payload: object } } }).message.attachment.payload).toEqual({ url: 'https://our.server/f.jpg' });
  });

  it('with no file it still sends the link, exactly as before', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { message_id: 'mid.out' } });
    await both().sendMediaMessage('t1', 'ch', 'PSID', 'video', 'https://our.server/v.mp4');
    expect(callsTo(post, 'message_attachments')).toHaveLength(0);
    expect((post.mock.calls[0][1] as { message: { attachment: { payload: object } } }).message.attachment.payload).toEqual({ url: 'https://our.server/v.mp4', is_reusable: true });
  });

  it.each([
    ['Messenger text', (s: FacebookMessengerService) => s.sendTextMessage('t1', 'ch', 'PSID', 'hi', 'mid.quoted')],
    ['Instagram text', (s: FacebookMessengerService) => s.sendInstagramTextMessage('t1', 'ch', 'IGSID', 'hi', 'mid.quoted')],
  ])('%s: quotes the replied-to message', async (_n, send) => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { message_id: 'mid.out' } });
    await send(both());
    expect((post.mock.calls[0][1] as { message: { reply_to?: { mid: string } } }).message.reply_to).toEqual({ mid: 'mid.quoted' });
  });

  it('retries without the quote if Meta rejects the reply link, so the message is never lost', async () => {
    const post = jest.spyOn(axios, 'post')
      .mockRejectedValueOnce(new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, undefined, { data: { error: { message: 'Invalid reply_to' } } } as never))
      .mockResolvedValueOnce({ data: { message_id: 'mid.out' } });
    await expect(both().sendTextMessage('t1', 'ch', 'PSID', 'hi', 'mid.quoted')).resolves.toBe('mid.out');
    expect((post.mock.calls[1][1] as { message: Record<string, unknown> }).message).toEqual({ text: 'hi' });
  });

  it('does not retry when there was no quote, and reports the failure', async () => {
    const post = jest.spyOn(axios, 'post').mockRejectedValue(new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, undefined, { data: { error: { message: 'Outside the allowed window' } } } as never));
    await expect(both().sendTextMessage('t1', 'ch', 'PSID', 'hi')).rejects.toThrow('Outside the allowed window');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('never puts the access token in the uploaded form or the message body', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: { attachment_id: 'att-1' } }).mockResolvedValueOnce({ data: { message_id: 'm' } });
    await both().sendMediaMessage('t1', 'ch', 'PSID', 'image', 'u', undefined, { file });
    expect(JSON.stringify(post.mock.calls[1][1])).not.toContain(TOKEN);
    expect(JSON.stringify([...(post.mock.calls[0][1] as FormData).entries()].map(([k, v]) => [k, typeof v === 'string' ? v : 'file']))).not.toContain(TOKEN);
  });
});
