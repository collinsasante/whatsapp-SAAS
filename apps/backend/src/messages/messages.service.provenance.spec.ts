import { MessagesService } from './messages.service';

/** What the inbox says about where a message's text came from is recorded as metadata, but only after it is checked against this tenant's own records. */
function setup(opts: { cannedFound?: boolean; suggestionFound?: boolean; enqueue?: jest.Mock } = {}) {
  const prisma = {
    message: {
      findFirst: jest.fn().mockResolvedValue({ createdAt: new Date() }),
      create: jest.fn().mockResolvedValue({ id: 'm1' }),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data })),
      findUnique: jest.fn().mockResolvedValue({ id: 'm1', status: 'SENT' }),
    },
    cannedResponse: { findFirst: jest.fn().mockResolvedValue(opts.cannedFound ? { id: 'canned-1' } : null) },
    aiInteractionLog: { findFirst: jest.fn().mockResolvedValue(opts.suggestionFound ? { id: 'log-1' } : null) },
  };
  const conversationsService = {
    findOne: jest.fn().mockResolvedValue({ id: 'c1', contactId: 'ct1', status: 'OPEN', assignedTo: null, channel: { id: 'ch1', type: 'WHATSAPP' }, contact: { id: 'ct1' }, whatsappNumberId: null }),
    touchLastMessage: jest.fn().mockResolvedValue(undefined),
  };
  const args: unknown[] = new Array(22).fill({});
  args[0] = prisma; args[1] = { sendTextMessage: jest.fn().mockResolvedValue('wamid.1') }; args[2] = conversationsService;
  args[3] = { findOne: jest.fn().mockResolvedValue({ id: 'ct1', phone: '+233555000111', isBlocked: false, optedOut: false }) };
  args[4] = { emitNewMessage: jest.fn() }; args[9] = { triggerLearningAsync: jest.fn() };
  args[21] = { enqueue: opts.enqueue ?? jest.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new (MessagesService as any)(...args) as MessagesService, prisma, enqueue: args[21] as { enqueue: jest.Mock } };
}
const created = (prisma: ReturnType<typeof setup>['prisma']) => prisma.message.create.mock.calls[0][0].data.metadata as Record<string, unknown> | undefined;

describe('MessagesService.sendMessage -- text provenance', () => {
  it('marks an unedited saved reply, after finding it among THIS tenant\'s saved replies', async () => {
    const { service, prisma } = setup({ cannedFound: true });
    await service.sendMessage('t1', 'c1', 'u1', { type: 'TEXT', content: 'Hi Abena', cannedResponseId: 'canned-1' } as never);
    expect(prisma.cannedResponse.findFirst).toHaveBeenCalledWith({ where: { id: 'canned-1', tenantId: 't1' }, select: { id: true } });
    expect(created(prisma)).toMatchObject({ source: 'saved_reply', cannedResponseId: 'canned-1' });
  });

  it('marks AI-written text, and that wins when both are claimed', async () => {
    const { service, prisma } = setup({ cannedFound: true, suggestionFound: true });
    await service.sendMessage('t1', 'c1', 'u1', { type: 'TEXT', content: 'Sure!', aiSuggestionLogId: 'log-1', cannedResponseId: 'canned-1' } as never);
    expect(prisma.aiInteractionLog.findFirst).toHaveBeenCalledWith({ where: { id: 'log-1', tenantId: 't1' }, select: { id: true } });
    expect(created(prisma)).toMatchObject({ source: 'ai_suggestion', aiSuggestionLogId: 'log-1' });
  });

  it('ignores an id that is not this tenant\'s, so text cannot be mislabelled and the send is unaffected', async () => {
    const { service, prisma } = setup();
    await service.sendMessage('t1', 'c1', 'u1', { type: 'TEXT', content: 'my own words', cannedResponseId: 'someone-elses', aiSuggestionLogId: 'also-not-mine' } as never);
    expect(created(prisma)).toBeUndefined();
  });

  it('records nothing when no provenance is given, and does not look anything up', async () => {
    const { service, prisma } = setup();
    await service.sendMessage('t1', 'c1', 'u1', { type: 'TEXT', content: 'hello' } as never);
    expect(created(prisma)).toBeUndefined();
    expect(prisma.cannedResponse.findFirst).not.toHaveBeenCalled();
    expect(prisma.aiInteractionLog.findFirst).not.toHaveBeenCalled();
  });
});

describe('MessagesService.sendMessage -- queues the reply for Digital Self learning', () => {
  it('queues a sent text reply with its tenant and id', async () => {
    const { service, enqueue } = setup();
    await service.sendMessage('t1', 'c1', 'u1', { type: 'TEXT', content: 'hello' } as never);
    expect(enqueue.enqueue).toHaveBeenCalledWith('t1', 'm1');
  });
  it('never fails or delays the send if queueing fails', async () => {
    const { service } = setup({ enqueue: jest.fn().mockRejectedValue(new Error('redis down')) });
    await expect(service.sendMessage('t1', 'c1', 'u1', { type: 'TEXT', content: 'hello' } as never)).resolves.toBeDefined();
  });
});
