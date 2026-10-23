import axios from 'axios';
import { Logger } from '@nestjs/common';
import { MessagesService } from './messages.service';

function setup() {
  const contactsService = { findOrCreateByExternalId: jest.fn().mockResolvedValue({ id: 'ct-ig', phone: null, name: null, externalId: 'IGSID-9' }) };
  const conversationsService = { findOrCreate: jest.fn().mockResolvedValue({ id: 'cv1', channelId: 'ch-ig', status: 'RESOLVED', unreadCount: 0 }), request: jest.fn() };
  const prisma = {
    message: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn((a: { data: Record<string, unknown> }) => ({ id: 'm1', createdAt: new Date(), ...a.data })) },
    conversation: { update: jest.fn().mockResolvedValue({ unreadCount: 1, status: 'RESOLVED' }) },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const realtimeService = { emitNewMessage: jest.fn(), emitConversationUpdated: jest.fn() };
  const storageService = { uploadRaw: jest.fn().mockResolvedValue({ fileUrl: 'https://files/ig.jpeg' }) };
  const facebookMessengerService = { fetchContactName: jest.fn().mockResolvedValue({ name: null, reason: 'not asked' }), sendInstagramTextMessage: jest.fn().mockResolvedValue('mid.1'), sendInstagramMediaMessage: jest.fn().mockResolvedValue('mid.2'), sendTextMessage: jest.fn(), sendMediaMessage: jest.fn().mockResolvedValue('mid.3') };
  const args: unknown[] = new Array(21).fill({});
  args[0] = prisma; args[2] = conversationsService; args[3] = contactsService; args[4] = realtimeService; args[5] = storageService; args[19] = facebookMessengerService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new (MessagesService as any)(...args) as any;
  return { service, contactsService, prisma, storageService, facebookMessengerService };
}

describe('handleInboundMessenger for Instagram', () => {
  afterEach(() => jest.restoreAllMocks());

  it('identifies the sender by Instagram-scoped id, a different identity from a Messenger PSID', async () => {
    const { service, contactsService } = setup();
    await service.handleInboundMessenger('t1', 'ch-ig', 'IGSID-9', { mid: 'm1', text: 'hi' }, 'INSTAGRAM');
    expect(contactsService.findOrCreateByExternalId).toHaveBeenCalledWith('t1', 'INSTAGRAM_IGSID', 'IGSID-9');
  });

  it('keeps Messenger exactly as before when no platform is given', async () => {
    const { service, contactsService } = setup();
    await service.handleInboundMessenger('t1', 'ch-fb', 'PSID-1', { mid: 'm1', text: 'hi' });
    expect(contactsService.findOrCreateByExternalId).toHaveBeenCalledWith('t1', 'MESSENGER_PSID', 'PSID-1');
  });

  it('downloads and stores an image, like Messenger', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: new ArrayBuffer(4), headers: { 'content-type': 'image/jpeg' } });
    const { service, prisma, storageService } = setup();
    await service.handleInboundMessenger('t1', 'ch-ig', 'IGSID-9', { mid: 'm1', attachments: [{ type: 'image', payload: { url: 'https://cdn/ig.jpg' } }] }, 'INSTAGRAM');
    expect(storageService.uploadRaw).toHaveBeenCalled();
    expect(prisma.message.create.mock.calls[0][0].data).toMatchObject({ type: 'IMAGE', mediaUrl: 'https://files/ig.jpeg' });
  });

  it.each([['share', 'Shared a post'], ['story_mention', 'Mentioned you in a story'], ['ig_reel', 'Shared a reel']])(
    'shows a %s as a labelled link and never downloads it as a file', async (type, label) => {
      const get = jest.spyOn(axios, 'get');
      const { service, prisma, storageService } = setup();
      await service.handleInboundMessenger('t1', 'ch-ig', 'IGSID-9', { mid: 'm1', text: 'look', attachments: [{ type, payload: { url: 'https://www.instagram.com/p/abc' } }] }, 'INSTAGRAM');
      expect(get).not.toHaveBeenCalled();
      expect(storageService.uploadRaw).not.toHaveBeenCalled();
      const data = prisma.message.create.mock.calls[0][0].data;
      expect(data.content).toBe(`look\n[${label}] https://www.instagram.com/p/abc`);
      expect(data.type).toBe('TEXT');
      expect(data.mediaUrl).toBeUndefined();
    },
  );

  it('does not drop an attachment with no url: it shows the usual placeholder', async () => {
    const { service, prisma } = setup();
    await service.handleInboundMessenger('t1', 'ch-ig', 'IGSID-9', { mid: 'm1', attachments: [{ type: 'ephemeral', payload: {} }] }, 'INSTAGRAM');
    expect(prisma.message.create.mock.calls[0][0].data.content).toContain("can't display yet");
  });

  it('is idempotent: a redelivered message id is not stored twice', async () => {
    const { service, prisma } = setup();
    prisma.message.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(service.handleInboundMessenger('t1', 'ch-ig', 'IGSID-9', { mid: 'm1', text: 'hi' }, 'INSTAGRAM')).resolves.toEqual({ id: 'existing' });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});

describe('inbound contact name lookup', () => {
  afterEach(() => jest.restoreAllMocks());
  const logged: string[] = [];
  beforeEach(() => {
    logged.length = 0;
    jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => { logged.push(String(m)); });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => { logged.push(String(m)); });
  });

  it('asks Meta for the name of a nameless Messenger contact and saves it', async () => {
    const { service, contactsService, facebookMessengerService } = setup();
    facebookMessengerService.fetchContactName.mockResolvedValue({ name: 'Ama Mensah' });
    await service.handleInboundMessenger('t1', 'ch-fb', 'PSID-1', { mid: 'm1', text: 'hi' });
    expect(facebookMessengerService.fetchContactName).toHaveBeenCalledWith('t1', 'ch-fb', 'MESSENGER', 'PSID-1');
    expect(contactsService.findOrCreateByExternalId).toHaveBeenLastCalledWith('t1', 'MESSENGER_PSID', 'PSID-1', 'Ama Mensah');
    expect(logged.join('\n')).toContain('name found');
    expect(logged.join('\n')).not.toContain('Ama Mensah');
  });

  it('does the same for Instagram, as an Instagram contact', async () => {
    const { service, contactsService, facebookMessengerService } = setup();
    facebookMessengerService.fetchContactName.mockResolvedValue({ name: '@glam_pack' });
    await service.handleInboundMessenger('t1', 'ch-ig', 'IGSID-9', { mid: 'm1', text: 'hi' }, 'INSTAGRAM');
    expect(facebookMessengerService.fetchContactName).toHaveBeenCalledWith('t1', 'ch-ig', 'INSTAGRAM', 'IGSID-9');
    expect(contactsService.findOrCreateByExternalId).toHaveBeenLastCalledWith('t1', 'INSTAGRAM_IGSID', 'IGSID-9', '@glam_pack');
  });

  it('does not ask Meta again for a contact that already has a name', async () => {
    const { service, contactsService, facebookMessengerService } = setup();
    contactsService.findOrCreateByExternalId.mockResolvedValue({ id: 'ct', phone: null, name: 'Ama Mensah', externalId: 'PSID-1' });
    await service.handleInboundMessenger('t1', 'ch-fb', 'PSID-1', { mid: 'm1', text: 'hi' });
    expect(facebookMessengerService.fetchContactName).not.toHaveBeenCalled();
  });

  it('logs why when Meta gives no name, and still stores the message', async () => {
    const { service, prisma, facebookMessengerService } = setup();
    facebookMessengerService.fetchContactName.mockResolvedValue({ name: null, reason: '(#10) permission missing' });
    await service.handleInboundMessenger('t1', 'ch-fb', 'PSID-1', { mid: 'm1', text: 'hi' });
    expect(logged.join('\n')).toContain('no name');
    expect(logged.join('\n')).toContain('permission missing');
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
  });

  it('a lookup that throws never loses the message', async () => {
    const { service, prisma, facebookMessengerService } = setup();
    facebookMessengerService.fetchContactName.mockRejectedValue(new Error('boom'));
    await expect(service.handleInboundMessenger('t1', 'ch-fb', 'PSID-1', { mid: 'm1', text: 'hi' })).resolves.toBeDefined();
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
    expect(logged.join('\n')).toContain('lookup failed');
  });
});

describe('dispatchOutbound for Instagram', () => {
  const conversation = { channel: { id: 'ch-ig', type: 'INSTAGRAM' } };
  const contact = { phone: null, externalId: 'IGSID-9', externalIdType: 'INSTAGRAM_IGSID' };

  it('sends text through the Instagram sender, to the contact\'s Instagram id', async () => {
    const { service, facebookMessengerService } = setup();
    await expect(service.dispatchOutbound('t1', conversation, contact, { kind: 'TEXT', text: 'hello' })).resolves.toBe('mid.1');
    expect(facebookMessengerService.sendInstagramTextMessage).toHaveBeenCalledWith('t1', 'ch-ig', 'IGSID-9', 'hello', undefined);
    expect(facebookMessengerService.sendTextMessage).not.toHaveBeenCalled();
  });

  it('sends media through the Instagram sender with a lower-case type', async () => {
    const { service, facebookMessengerService } = setup();
    jest.spyOn(service, 'loadMediaBuffer').mockRejectedValue(new Error('no storage in this test'));
    await service.dispatchOutbound('t1', conversation, contact, { kind: 'MEDIA', mediaType: 'IMAGE', mediaUrl: 'https://f/x.jpg', caption: 'c' });
    expect(facebookMessengerService.sendInstagramMediaMessage).toHaveBeenCalledWith('t1', 'ch-ig', 'IGSID-9', 'image', 'https://f/x.jpg', 'c', { file: undefined, replyToMid: undefined });
  });

  it('refuses a contact with no Instagram id', async () => {
    const { service, facebookMessengerService } = setup();
    await expect(service.dispatchOutbound('t1', conversation, { phone: null, externalId: null }, { kind: 'TEXT', text: 'x' })).rejects.toThrow('no Instagram ID');
    expect(facebookMessengerService.sendInstagramTextMessage).not.toHaveBeenCalled();
  });
});

describe('dispatchOutbound media for Messenger and Instagram', () => {
  afterEach(() => jest.restoreAllMocks());
  const ig = { channel: { id: 'ch-ig', type: 'INSTAGRAM' } };
  const fb = { channel: { id: 'ch-fb', type: 'FACEBOOK_MESSENGER' } };
  const contact = { phone: null, externalId: 'ID-9' };
  const m4a = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypM4A '), Buffer.alloc(16)]);
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const png = Buffer.from('PNGDATA-not-audio');

  it('passes the loaded file and the quoted message id to the Messenger sender', async () => {
    const { service, facebookMessengerService } = setup();
    jest.spyOn(service, 'loadMediaBuffer').mockResolvedValue({ buffer: png, mimeType: 'image/png' });
    await service.dispatchOutbound('t1', fb, contact, { kind: 'MEDIA', mediaType: 'IMAGE', mediaUrl: 'https://x/api/v1/media/serve/k', caption: 'c', replyToProviderId: 'mid.q' });
    expect(facebookMessengerService.sendMediaMessage).toHaveBeenCalledWith('t1', 'ch-fb', 'ID-9', 'image', 'https://x/api/v1/media/serve/k', 'c',
      { file: { buffer: png, mimeType: 'image/png', filename: 'file.png' }, replyToMid: 'mid.q' });
  });

  it('does the same for Instagram', async () => {
    const { service, facebookMessengerService } = setup();
    jest.spyOn(service, 'loadMediaBuffer').mockResolvedValue({ buffer: png, mimeType: 'image/jpeg' });
    await service.dispatchOutbound('t1', ig, contact, { kind: 'MEDIA', mediaType: 'IMAGE', mediaUrl: 'u', replyToProviderId: 'mid.q' });
    expect(facebookMessengerService.sendInstagramMediaMessage).toHaveBeenCalledWith('t1', 'ch-ig', 'ID-9', 'image', 'u', undefined,
      expect.objectContaining({ file: expect.objectContaining({ filename: 'file.jpeg' }), replyToMid: 'mid.q' }));
    await service.dispatchOutbound('t1', ig, contact, { kind: 'TEXT', text: 'hi', replyToProviderId: 'mid.q2' });
    expect(facebookMessengerService.sendInstagramTextMessage).toHaveBeenLastCalledWith('t1', 'ch-ig', 'ID-9', 'hi', 'mid.q2');
  });

  it('keeps audio that Meta can already play (M4A) untouched', async () => {
    const { service } = setup();
    jest.spyOn(service, 'loadMediaBuffer').mockResolvedValue({ buffer: m4a, mimeType: 'audio/mp4' });
    const file = await service.prepareMetaFile('AUDIO', 'u');
    expect(file.buffer).toBe(m4a);
    expect(file.mimeType).toBe('audio/mp4');
  });

  it('refuses a voice note that cannot be converted, with a clear reason, instead of sending something unplayable', async () => {
    const { service } = setup();
    jest.spyOn(service, 'loadMediaBuffer').mockResolvedValue({ buffer: webm, mimeType: 'audio/webm' }); // truncated: ffmpeg cannot read it
    await expect(service.prepareMetaFile('AUDIO', 'u')).rejects.toThrow('could not be converted');
  });

  it('falls back to sending the link when the stored file cannot be loaded', async () => {
    const { service } = setup();
    jest.spyOn(service, 'loadMediaBuffer').mockRejectedValue(new Error('storage down'));
    await expect(service.prepareMetaFile('IMAGE', 'u')).resolves.toBeUndefined();
  });

  it('WhatsApp conversations are untouched: no Meta file preparation, no Messenger sender', async () => {
    const { service, facebookMessengerService } = setup();
    const load = jest.spyOn(service, 'loadMediaBuffer');
    service.whatsappService = { sendMediaMessage: jest.fn(), sendTextMessage: jest.fn().mockResolvedValue('wamid.1') };
    await service.dispatchOutbound('t1', { channel: { id: 'c', type: 'WHATSAPP' } }, { phone: '+233555000111' }, { kind: 'TEXT', text: 'hi', replyToProviderId: 'wamid.q' });
    expect(load).not.toHaveBeenCalled();
    expect(facebookMessengerService.sendTextMessage).not.toHaveBeenCalled();
  });
});
