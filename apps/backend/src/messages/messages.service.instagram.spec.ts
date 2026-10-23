import axios from 'axios';
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
  const facebookMessengerService = { sendInstagramTextMessage: jest.fn().mockResolvedValue('mid.1'), sendInstagramMediaMessage: jest.fn().mockResolvedValue('mid.2'), sendTextMessage: jest.fn() };
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

describe('dispatchOutbound for Instagram', () => {
  const conversation = { channel: { id: 'ch-ig', type: 'INSTAGRAM' } };
  const contact = { phone: null, externalId: 'IGSID-9', externalIdType: 'INSTAGRAM_IGSID' };

  it('sends text through the Instagram sender, to the contact\'s Instagram id', async () => {
    const { service, facebookMessengerService } = setup();
    await expect(service.dispatchOutbound('t1', conversation, contact, { kind: 'TEXT', text: 'hello' })).resolves.toBe('mid.1');
    expect(facebookMessengerService.sendInstagramTextMessage).toHaveBeenCalledWith('t1', 'ch-ig', 'IGSID-9', 'hello');
    expect(facebookMessengerService.sendTextMessage).not.toHaveBeenCalled();
  });

  it('sends media through the Instagram sender with a lower-case type', async () => {
    const { service, facebookMessengerService } = setup();
    await service.dispatchOutbound('t1', conversation, contact, { kind: 'MEDIA', mediaType: 'IMAGE', mediaUrl: 'https://f/x.jpg', caption: 'c' });
    expect(facebookMessengerService.sendInstagramMediaMessage).toHaveBeenCalledWith('t1', 'ch-ig', 'IGSID-9', 'image', 'https://f/x.jpg', 'c');
  });

  it('refuses a contact with no Instagram id', async () => {
    const { service, facebookMessengerService } = setup();
    await expect(service.dispatchOutbound('t1', conversation, { phone: null, externalId: null }, { kind: 'TEXT', text: 'x' })).rejects.toThrow('no Instagram ID');
    expect(facebookMessengerService.sendInstagramTextMessage).not.toHaveBeenCalled();
  });
});
