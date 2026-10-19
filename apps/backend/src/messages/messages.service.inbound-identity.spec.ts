import { MessagesService } from './messages.service';

function setup() {
  const contactsService = {
    findOrCreate: jest.fn().mockResolvedValue({ id: 'ct-phone', phone: '+233555000111', name: null }),
    findOrCreateByExternalId: jest.fn().mockResolvedValue({ id: 'ct-lid', phone: null, name: null, externalId: '1587145059558262@lid', externalIdType: 'WHATSAPP_JID' }),
  };
  const conversationsService = {
    findOrCreate: jest.fn().mockResolvedValue({ id: 'cv1', channelId: 'chan1', status: 'RESOLVED', unreadCount: 0 }),
    request: jest.fn(),
  };
  const prisma = {
    message: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'm1', createdAt: new Date() }) },
    conversation: { update: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const realtimeService = { emitNewMessage: jest.fn(), emitConversationUpdated: jest.fn() };
  const args: unknown[] = new Array(21).fill({});
  args[0] = prisma; args[2] = conversationsService; args[3] = contactsService; args[4] = realtimeService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new (MessagesService as any)(...args) as MessagesService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jest.spyOn(service as any, 'dispatchAiAndChatbot').mockResolvedValue(undefined);
  return { service, contactsService };
}

describe('handleInboundWhatsAppWeb -- sender identity', () => {
  it('a phone sender is resolved by phone', async () => {
    const { service, contactsService } = setup();
    await service.handleInboundWhatsAppWeb('t1', 'chan1', '233555000111', 'wa-1', { content: 'hi' }, 'Jane');
    expect(contactsService.findOrCreate).toHaveBeenCalledWith('t1', '233555000111', 'Jane');
    expect(contactsService.findOrCreateByExternalId).not.toHaveBeenCalled();
  });

  it('an anonymous @lid sender becomes its own WHATSAPP_JID identity and is never run through phone normalization', async () => {
    const { service, contactsService } = setup();
    await service.handleInboundWhatsAppWeb('t1', 'chan1', { jid: '1587145059558262@lid' }, 'wa-2', { content: 'Hi' }, 'GH.1587145059558262');
    expect(contactsService.findOrCreateByExternalId).toHaveBeenCalledWith('t1', 'WHATSAPP_JID', '1587145059558262@lid', 'GH.1587145059558262');
    expect(contactsService.findOrCreate).not.toHaveBeenCalled();
  });
});

describe('dispatchOutbound -- WhatsApp Web target', () => {
  function build() {
    const whatsAppWebService = { sendText: jest.fn().mockResolvedValue('p1'), sendMedia: jest.fn().mockResolvedValue('p2') };
    const args: unknown[] = new Array(21).fill({});
    args[20] = whatsAppWebService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new (MessagesService as any)(...args) as any;
    return { service, whatsAppWebService };
  }
  const conversation = { channel: { id: 'chan1', type: 'WHATSAPP_WEB' } };

  it('replies to a phone-less contact at its exact anonymous address', async () => {
    const { service, whatsAppWebService } = build();
    await service.dispatchOutbound('t1', conversation, { phone: null, externalId: '1587145059558262@lid', externalIdType: 'WHATSAPP_JID' }, { kind: 'TEXT', text: 'hello' });
    expect(whatsAppWebService.sendText).toHaveBeenCalledWith('t1', 'chan1', { jid: '1587145059558262@lid' }, 'hello');
  });

  it('prefers the phone number when the contact has one', async () => {
    const { service, whatsAppWebService } = build();
    await service.dispatchOutbound('t1', conversation, { phone: '+233555000111', externalId: null }, { kind: 'TEXT', text: 'hello' });
    expect(whatsAppWebService.sendText).toHaveBeenCalledWith('t1', 'chan1', '+233555000111', 'hello');
  });

  it('refuses a contact with no phone and no WhatsApp address, and does not treat another platform id as one', async () => {
    const { service, whatsAppWebService } = build();
    await expect(service.dispatchOutbound('t1', conversation, { phone: null, externalId: 'psid-1', externalIdType: 'MESSENGER_PSID' }, { kind: 'TEXT', text: 'x' })).rejects.toThrow('no phone number');
    expect(whatsAppWebService.sendText).not.toHaveBeenCalled();
  });
});

describe('handleInboundWhatsAppWeb -- placeholders are not customer questions', () => {
  it.each([
    ['a view-once placeholder', { content: '[View-once message. Open it on your phone]', placeholder: true }],
    ['a sticker label', { content: '[Sticker]', placeholder: true }],
    ['a type with no content at all', {}],
  ])('does not run the AI or chatbot for %s, but still stores the message', async (_l, payload) => {
    const { service } = setup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dispatch = (service as any).dispatchAiAndChatbot as jest.Mock;
    const result = await service.handleInboundWhatsAppWeb('t1', 'chan1', '233555000111', 'wa-p', payload);
    expect(result).toBeDefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('still runs the AI for real customer text', async () => {
    const { service } = setup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dispatch = (service as any).dispatchAiAndChatbot as jest.Mock;
    await service.handleInboundWhatsAppWeb('t1', 'chan1', '233555000111', 'wa-t', { content: 'Hi' });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
