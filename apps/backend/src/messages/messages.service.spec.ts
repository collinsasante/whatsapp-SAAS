import { MessagesService } from './messages.service';

/**
 * Verz-AI unification, Phase C: this routing logic (commerceEnabled + aiMode
 * resolved once, dispatched to one of two unified post-processing paths) had zero
 * unit coverage before this phase -- these tests exercise the newly-extracted
 * private methods directly (generateAiReply/handleAiSuggestion/handleAiAutoReply),
 * which is the pragmatic way to cover them without mocking every dependency of the
 * much larger handleInbound entry point.
 */
function buildDeps() {
  return {
    prisma: {
      tenantSettings: { findUnique: jest.fn().mockResolvedValue(null) },
      tenant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      message: { create: jest.fn().mockResolvedValue({ id: 'msg-1' }), findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(1) },
      // Default: no assignee on a fresh ownership-recheck lookup, i.e. "not
      // human-handled" -- matches every existing test's assumption that AI is
      // free to proceed. Tests of the human-ownership guard itself override
      // this per-call via mockResolvedValueOnce/mockResolvedValue.
      conversation: { findFirst: jest.fn().mockResolvedValue({ assignedTo: null }), update: jest.fn().mockResolvedValue({ id: 'conv1' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    },
    whatsappService: {
      sendTextMessage: jest.fn().mockResolvedValue(undefined),
      uploadMediaToMeta: jest.fn().mockResolvedValue('meta-media-id'),
      sendMediaMessageById: jest.fn().mockResolvedValue('wamid.media'),
      sendMediaMessage: jest.fn().mockResolvedValue('wamid.media-fallback'),
    },
    conversationsService: {
      request: jest.fn().mockResolvedValue(null), requestWithRetry: jest.fn().mockResolvedValue(true),
      findOrCreate: jest.fn().mockResolvedValue({ id: 'conv1', status: 'OPEN', channelId: 'chan1', unreadCount: 0 }),
    },
    contactsService: { findOrCreate: jest.fn().mockResolvedValue({ id: 'contact1', phone: '+233555000111', name: 'Jane' }) },
    realtimeService: { emitAiSuggestion: jest.fn(), emitNewMessage: jest.fn(), emitConversationUpdated: jest.fn() },
    storageService: { downloadBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from('img'), mimeType: 'image/jpeg' }) },
    chatbotFlowsService: { findMatchingFlow: jest.fn().mockResolvedValue(null) },
    activityLogService: {},
    aiResponderService: {
      findOrCreateVerzAgent: jest.fn().mockResolvedValue({ id: 'agent-1', name: 'Verz', avatarUrl: null }),
      generateSuggestion: jest.fn().mockImplementation(async (
        _tenantId: string,
        _conversationId: string,
        _customerMessage: string,
        _contactName: string | undefined,
        providerCallWrapper?: (providerCall: () => Promise<unknown>) => Promise<unknown>,
      ) => {
        if (providerCallWrapper) await providerCallWrapper(() => Promise.resolve({ data: {} }));
        return { response: 'Hi there', confidence: 80, blocked: false };
      }),
      shouldRespond: jest.fn().mockResolvedValue(true),
      getMode: jest.fn().mockResolvedValue(null),
    },
    knowledgeBaseService: {},
    aiLogsService: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
    commerceAiService: {
      handleMessage: jest.fn().mockResolvedValue({ response: 'We have that in stock.', blocked: false, toolTrace: [] }),
    },
    featureFlagsService: { isEnabledCached: jest.fn().mockResolvedValue(false) },
    aiAgentsService: { findOrCreateDefaultAgent: jest.fn().mockResolvedValue({ id: 'agent-2' }) },
    verzAiPipeline: { run: jest.fn().mockResolvedValue({ response: 'v2 reply', confidence: 90, blocked: false, executionId: 'exec-1' }) },
    aiExecutionsService: { linkInteractionLog: jest.fn().mockResolvedValue(null) },
    leadsService: { scoreConversation: jest.fn().mockResolvedValue(null) },
    aiCreditsService: {
      hasSufficientBalance: jest.fn().mockResolvedValue(true),
      chargeFlat: jest.fn().mockResolvedValue({ settled: true, transaction: null }),
      reserveFixedCredits: jest.fn().mockResolvedValue({ id: 'reservation-1' }),
      settleReservation: jest.fn().mockResolvedValue({ settled: true, transaction: { id: 'txn-1' } }),
      releaseReservation: jest.fn().mockResolvedValue(undefined),
    },
    conversationState: { getState: jest.fn().mockResolvedValue(null), mergeState: jest.fn().mockResolvedValue(undefined) },
    facebookMessengerService: { sendTextMessage: jest.fn().mockResolvedValue('mid-1'), sendMediaMessage: jest.fn().mockResolvedValue('mid-2') },
    whatsAppWebService: { sendText: jest.fn().mockResolvedValue('wa-web-mid-1'), sendMedia: jest.fn().mockResolvedValue('wa-web-mid-2') },
  };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  return new MessagesService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deps.prisma as any, deps.whatsappService as any, deps.conversationsService as any, deps.contactsService as any,
    deps.realtimeService as any, deps.storageService as any, deps.chatbotFlowsService as any, deps.activityLogService as any,
    deps.aiResponderService as any, deps.knowledgeBaseService as any, deps.aiLogsService as any, deps.commerceAiService as any,
    deps.featureFlagsService as any, deps.aiAgentsService as any, deps.verzAiPipeline as any, deps.aiExecutionsService as any,
    deps.leadsService as any, deps.aiCreditsService as any, deps.conversationState as any, deps.facebookMessengerService as any,
    deps.whatsAppWebService as any,
  );
}

const conversation = { id: 'conv1' };
const contact = { id: 'contact1', phone: '+233555000111', name: 'Jane' };

describe('MessagesService -- Verz-AI unification, Phase C routing', () => {
  describe('generateAiReply', () => {
    it('routes to CommerceAiService when commerceEnabled, normalizing its result', async () => {
      const deps = buildDeps();
      deps.commerceAiService.handleMessage.mockResolvedValue({ response: 'ok', blocked: false, toolTrace: [{ name: 'search_products', args: {}, result: {} }] });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (service as any).generateAiReply('t1', 'conv1', 'contact1', '+233555000111', 'hi', 'Jane', { commerceEnabled: true, readOnlyTools: true });

      expect(deps.commerceAiService.handleMessage).toHaveBeenCalledWith('t1', 'conv1', 'contact1', '+233555000111', 'hi', 'Jane', undefined, { readOnlyTools: true });
      expect(result).toEqual({ response: 'ok', confidence: null, blocked: false, executionId: null, toolTrace: [{ name: 'search_products', args: {}, result: {} }] });
      expect(deps.featureFlagsService.isEnabledCached).not.toHaveBeenCalled();
    });

    it('routes to the v2 pipeline when not commerce-enabled and verz_ai_v2 is on', async () => {
      const deps = buildDeps();
      deps.featureFlagsService.isEnabledCached.mockResolvedValue(true);
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (service as any).generateAiReply('t1', 'conv1', 'contact1', '+233555000111', 'hi', 'Jane', { commerceEnabled: false, readOnlyTools: false });

      expect(deps.aiAgentsService.findOrCreateDefaultAgent).toHaveBeenCalledWith('t1');
      expect(deps.verzAiPipeline.run).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', conversationId: 'conv1', taskType: 'RESPONDER' }));
      expect(result).toEqual({ response: 'v2 reply', confidence: 90, blocked: false, executionId: 'exec-1' });
    });

    it('routes to the legacy responder when not commerce-enabled and verz_ai_v2 is off, forcing executionId null', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (service as any).generateAiReply('t1', 'conv1', 'contact1', '+233555000111', 'hi', 'Jane', { commerceEnabled: false, readOnlyTools: false });

      expect(deps.aiResponderService.generateSuggestion).toHaveBeenCalledWith('t1', 'conv1', 'hi', 'Jane', expect.any(Function));
      expect(result).toEqual({ response: 'Hi there', confidence: 80, blocked: false, executionId: null });
    });

    it('reserves the legacy flat estimate before the provider call and settles it after success', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).generateAiReply('t1', 'conv1', 'contact1', '+233555000111', 'hi', 'Jane', { commerceEnabled: false, readOnlyTools: false });

      expect(deps.aiCreditsService.reserveFixedCredits).toHaveBeenCalledWith('t1', expect.any(Number));
      expect(deps.aiCreditsService.settleReservation).toHaveBeenCalledWith(
        'reservation-1',
        expect.any(Number),
        'Legacy AI responder usage',
        { estimated: true, reason: 'legacy path, no token tracking' },
      );
      expect(deps.aiCreditsService.chargeFlat).not.toHaveBeenCalled();
    });

    it('does not charge the legacy flat amount when the legacy responder produced no response', async () => {
      const deps = buildDeps();
      deps.aiResponderService.generateSuggestion.mockResolvedValue({ response: '', confidence: null, blocked: false });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).generateAiReply('t1', 'conv1', 'contact1', '+233555000111', 'hi', 'Jane', { commerceEnabled: false, readOnlyTools: false });

      expect(deps.aiCreditsService.chargeFlat).not.toHaveBeenCalled();
      expect(deps.aiCreditsService.reserveFixedCredits).not.toHaveBeenCalled();
    });

    it('does not charge a flat amount for the commerce or v2 pipeline paths -- those settle centrally via AiExecutionsService', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).generateAiReply('t1', 'conv1', 'contact1', '+233555000111', 'hi', 'Jane', { commerceEnabled: true, readOnlyTools: false });

      expect(deps.aiCreditsService.chargeFlat).not.toHaveBeenCalled();
    });
  });

  describe('handleAiSuggestion', () => {
    it('never persists a message, never decrements credits, and logs status SUGGESTED', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiSuggestion('t1', conversation, contact, 'hi', false);

      expect(deps.prisma.message.create).not.toHaveBeenCalled();
      expect(deps.prisma.tenant.updateMany).not.toHaveBeenCalled();
      expect(deps.aiLogsService.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUGGESTED' }));
      expect(deps.realtimeService.emitAiSuggestion).toHaveBeenCalledWith('t1', 'conv1', expect.objectContaining({ logId: 'log-1' }));
    });

    it('requests read-only tools from Commerce', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiSuggestion('t1', conversation, contact, 'hi', true);

      expect(deps.commerceAiService.handleMessage).toHaveBeenCalledWith('t1', 'conv1', 'contact1', '+233555000111', 'hi', 'Jane', undefined, { readOnlyTools: true, channelType: 'WHATSAPP' });
    });

    it('scores the lead only when commerceEnabled', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiSuggestion('t1', conversation, contact, 'hi', false);
      expect(deps.leadsService.scoreConversation).not.toHaveBeenCalled();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiSuggestion('t1', conversation, contact, 'hi', true);
      expect(deps.leadsService.scoreConversation).toHaveBeenCalledWith('t1', 'conv1', 'contact1');
    });

    it('escalates the conversation when the generator says shouldEscalate', async () => {
      const deps = buildDeps();
      deps.aiResponderService.generateSuggestion.mockResolvedValue({ response: 'Let me get someone', confidence: 20, blocked: false, shouldEscalate: true });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiSuggestion('t1', conversation, contact, 'hi', false);

      expect(deps.conversationsService.requestWithRetry).toHaveBeenCalledWith('t1', 'conv1', expect.any(String));
    });

    it('escalates for real (but never auto-sends) when the generator rejects, instead of silently doing nothing', async () => {
      const deps = buildDeps();
      deps.commerceAiService.handleMessage.mockRejectedValue(new Error('provider down'));
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((service as any).handleAiSuggestion('t1', conversation, contact, 'hi', true)).resolves.toBeUndefined();
      expect(deps.aiLogsService.create).not.toHaveBeenCalled();
      expect(deps.conversationsService.requestWithRetry).toHaveBeenCalledWith('t1', 'conv1', expect.any(String));
    });

    it('degrades gracefully when aiLogsService.create rejects, without throwing', async () => {
      const deps = buildDeps();
      deps.aiLogsService.create.mockRejectedValue(new Error('db down'));
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((service as any).handleAiSuggestion('t1', conversation, contact, 'hi', false)).resolves.toBeUndefined();
      expect(deps.realtimeService.emitAiSuggestion).not.toHaveBeenCalled();
    });
  });

  describe('handleAiAutoReply', () => {
    it.each(['FACEBOOK_MESSENGER', 'INSTAGRAM'])('tells the AI it is writing on %s, so it formats plain text', async (type) => {
      const deps = buildDeps();
      const service = buildService(deps);
      const metaConversation = { ...conversation, channel: { id: 'chan1', type } };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', metaConversation, contact, 'hi', true, null);

      expect(deps.commerceAiService.handleMessage).toHaveBeenCalledWith('t1', 'conv1', 'contact1', '+233555000111', 'hi', 'Jane', undefined, { readOnlyTools: false, channelType: 'FACEBOOK_MESSENGER' });
    });

    it('also for the suggestion path on Instagram', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiSuggestion('t1', { ...conversation, channel: { id: 'chan1', type: 'INSTAGRAM' } }, contact, 'hi', true);
      expect(deps.commerceAiService.handleMessage).toHaveBeenCalledWith('t1', 'conv1', 'contact1', '+233555000111', 'hi', 'Jane', undefined, { readOnlyTools: true, channelType: 'FACEBOOK_MESSENGER' });
    });

    it('sends, persists with commerce:true metadata, and logs AUTO_SENT when commerceEnabled', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', true, null);

      expect(deps.commerceAiService.handleMessage).toHaveBeenCalledWith('t1', 'conv1', 'contact1', '+233555000111', 'hi', 'Jane', undefined, { readOnlyTools: false, channelType: 'WHATSAPP' });
      expect(deps.whatsappService.sendTextMessage).toHaveBeenCalledWith('t1', '+233555000111', 'We have that in stock.', undefined, undefined);
      expect(deps.prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: { aiGenerated: true, commerce: true } }) }));
      expect(deps.aiLogsService.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'AUTO_SENT' }));
    });

    describe('delivery of the AI reply is recorded truthfully', () => {
      const created = (deps: ReturnType<typeof buildDeps>) => deps.prisma.message.create.mock.calls.map((c: [{ data: Record<string, unknown> }]) => c[0].data);

      it("stores the channel's message id with the reply, so delivered and read ticks can find it", async () => {
        const deps = buildDeps();
        deps.whatsappService.sendTextMessage.mockResolvedValue('wamid.AI-1');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (buildService(deps) as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null);
        expect(created(deps)[0]).toMatchObject({ direction: 'OUTBOUND', status: 'SENT', whatsappMessageId: 'wamid.AI-1', content: 'Hi there' });
      });

      it('on Messenger, replies to the customer on the conversation\'s own Page and stores the Page message id', async () => {
        const deps = buildDeps();
        const psid = { ...contact, phone: null, externalId: 'PSID-9', externalIdType: 'MESSENGER_PSID' };
        const messenger = { ...conversation, channel: { id: 'chan-page-1', type: 'FACEBOOK_MESSENGER' } };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (buildService(deps) as any).handleAiAutoReply('t1', messenger, psid, 'hi', false, null);
        expect(deps.facebookMessengerService.sendTextMessage).toHaveBeenCalledWith('t1', 'chan-page-1', 'PSID-9', 'Hi there', undefined);
        expect(deps.whatsappService.sendTextMessage).not.toHaveBeenCalled();
        expect(created(deps)[0]).toMatchObject({ status: 'SENT', whatsappMessageId: 'mid-1' });
      });

      it('a reply the channel refuses is stored as FAILED with no message id, not as delivered, and still appears in the inbox', async () => {
        const deps = buildDeps();
        deps.whatsappService.sendTextMessage.mockRejectedValue(new Error('(#131047) Re-engagement message'));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (buildService(deps) as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null);
        const row = created(deps)[0];
        expect(row).toMatchObject({ status: 'FAILED', failureReason: 'The channel did not accept this message.' });
        expect(row['whatsappMessageId']).toBeUndefined();
        expect(JSON.stringify(row)).not.toContain('131047'); // the provider's wording is logged, not stored
        expect(deps.realtimeService.emitNewMessage).toHaveBeenCalled();
      });
    });

    it('omits the commerce marker when not commerce-enabled', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null);

      expect(deps.prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: { aiGenerated: true } }) }));
    });

    it('no longer decrements credits itself -- Verz AI Credits settles centrally as part of generation, not as a pre-send gate', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null);

      expect(deps.prisma.tenant.updateMany).not.toHaveBeenCalled();
      expect(deps.whatsappService.sendTextMessage).toHaveBeenCalled();
    });

    it('self-assigns and emits conversationUpdated only when there is no existing assignee', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null);

      expect(deps.prisma.conversation.updateMany).toHaveBeenCalledWith({ where: { id: 'conv1', tenantId: 't1', assignedToId: null }, data: { assignedToId: 'agent-1', status: 'OPEN' } });
      expect(deps.realtimeService.emitConversationUpdated).toHaveBeenCalled();
      expect(deps.realtimeService.emitNewMessage).toHaveBeenCalledWith('t1', 'conv1', { id: 'msg-1' });
    });

    it('delivers a tool-triggered media side effect after the text reply, persisted as its own IMAGE message (Verz-AI unification, Phase G)', async () => {
      const deps = buildDeps();
      deps.commerceAiService.handleMessage.mockResolvedValue({
        response: 'Here you go',
        blocked: false,
        toolTrace: [],
        mediaToSend: [{ type: 'send_media', mediaUrl: '/api/v1/media/serve/products/x.jpg', mediaType: 'IMAGE', caption: 'Shrink Film', productId: 'p1' }],
      });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'send me a pic', true, null);

      expect(deps.whatsappService.sendTextMessage).toHaveBeenCalledWith('t1', '+233555000111', 'Here you go', undefined, undefined);
      expect(deps.whatsappService.uploadMediaToMeta).toHaveBeenCalledWith('t1', Buffer.from('img'), 'image/jpeg', expect.any(String), undefined);
      expect(deps.whatsappService.sendMediaMessageById).toHaveBeenCalledWith('t1', '+233555000111', 'image', 'meta-media-id', 'Shrink Film', undefined, undefined);
      expect(deps.prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: 'IMAGE', status: 'SENT', mediaUrl: '/api/v1/media/serve/products/x.jpg', metadata: { aiGenerated: true, productId: 'p1' } }),
      }));
    });

    it('skips self-assignment when the conversation is already assigned', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, { id: 'human-1', isAiAgent: false });

      expect(deps.prisma.conversation.updateMany).not.toHaveBeenCalled();
      expect(deps.realtimeService.emitConversationUpdated).not.toHaveBeenCalled();
      expect(deps.realtimeService.emitNewMessage).toHaveBeenCalled();
    });

    it('does not emit conversationUpdated when the self-assign write fails', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.updateMany.mockRejectedValue(new Error('db down'));
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null);

      expect(deps.realtimeService.emitConversationUpdated).not.toHaveBeenCalled();
      expect(deps.realtimeService.emitNewMessage).toHaveBeenCalled();
    });

    it('escalates the conversation when the generator says shouldEscalate', async () => {
      const deps = buildDeps();
      deps.aiResponderService.generateSuggestion.mockResolvedValue({ response: 'ok', confidence: 20, blocked: false, shouldEscalate: true });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null);

      expect(deps.conversationsService.requestWithRetry).toHaveBeenCalledWith('t1', 'conv1', expect.any(String));
    });

    it('second hardening pass, Section 4: keeps the generator\'s own optimistic text when the handoff actually succeeds', async () => {
      const deps = buildDeps();
      deps.aiResponderService.generateSuggestion.mockResolvedValue({ response: "Sure, I'll get someone to help.", confidence: 20, blocked: false, shouldEscalate: true });
      deps.conversationsService.requestWithRetry.mockResolvedValue(true);
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null);

      expect(deps.whatsappService.sendTextMessage).toHaveBeenCalledWith('t1', contact.phone, "Sure, I'll get someone to help.", undefined, undefined);
    });

    it('second hardening pass, Section 4: rewrites the response to an honest message when the handoff actually fails, instead of sending the generator\'s optimistic claim', async () => {
      const deps = buildDeps();
      deps.aiResponderService.generateSuggestion.mockResolvedValue({ response: "Sure, I'll get someone to help.", confidence: 20, blocked: false, shouldEscalate: true });
      deps.conversationsService.requestWithRetry.mockResolvedValue(false);
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null);

      const sentText = deps.whatsappService.sendTextMessage.mock.calls[0][2];
      expect(sentText).not.toBe("Sure, I'll get someone to help.");
      expect(sentText).toMatch(/trouble connecting|kept this conversation open/i);
    });

    it('sends a graceful fallback and escalates for real when the generator rejects, instead of leaving the customer with nothing', async () => {
      const deps = buildDeps();
      deps.commerceAiService.handleMessage.mockRejectedValue(new Error('provider down'));
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((service as any).handleAiAutoReply('t1', conversation, contact, 'hi', true, null)).resolves.toBeUndefined();
      expect(deps.whatsappService.sendTextMessage).toHaveBeenCalledWith('t1', contact.phone, expect.any(String), undefined, undefined);
      expect(deps.conversationsService.requestWithRetry).toHaveBeenCalledWith('t1', 'conv1', expect.any(String));
    });

    it('second hardening pass, Section 4: sends the honest "still having trouble" text (not the optimistic one) when the generator threw AND the real handoff also fails', async () => {
      const deps = buildDeps();
      deps.commerceAiService.handleMessage.mockRejectedValue(new Error('provider down'));
      deps.conversationsService.requestWithRetry.mockResolvedValue(false);
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', true, null);

      const sentText = deps.whatsappService.sendTextMessage.mock.calls[0][2];
      expect(sentText).toMatch(/trouble connecting|kept this conversation open/i);
    });

    it('degrades gracefully when message persistence fails, without throwing or emitting', async () => {
      const deps = buildDeps();
      deps.prisma.message.create.mockRejectedValue(new Error('db down'));
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null)).resolves.toBeUndefined();
      expect(deps.realtimeService.emitNewMessage).not.toHaveBeenCalled();
    });
  });

  describe('human-ownership guard (AI must not intervene in human-handled conversations)', () => {
    const PRESENT_AGENT = { id: 'human-1', isAiAgent: false, lastSeenAt: new Date() };
    const AWAY_AGENT = { id: 'human-1', isAiAgent: false, lastSeenAt: new Date(Date.now() - 4 * 60 * 60 * 1000) }; // 4h ago, past AI_TAKEOVER_AWAY_MS (3h)

    // 1. Assigned human agent: zero AI provider calls.
    it('suppresses handleAiSuggestion with zero provider calls when the conversation is assigned to a present human agent', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst.mockResolvedValue({ assignedTo: PRESENT_AGENT });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiSuggestion('t1', conversation, contact, 'hi', false, false, true);

      expect(deps.aiResponderService.generateSuggestion).not.toHaveBeenCalled();
      expect(deps.commerceAiService.handleMessage).not.toHaveBeenCalled();
      expect(deps.verzAiPipeline.run).not.toHaveBeenCalled();
      expect(deps.aiLogsService.create).not.toHaveBeenCalled();
    });

    it('suppresses handleAiAutoReply with zero provider calls and no send when the conversation is assigned to a present human agent', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst.mockResolvedValue({ assignedTo: PRESENT_AGENT });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, PRESENT_AGENT, false, true);

      expect(deps.aiResponderService.generateSuggestion).not.toHaveBeenCalled();
      expect(deps.commerceAiService.handleMessage).not.toHaveBeenCalled();
      expect(deps.whatsappService.sendTextMessage).not.toHaveBeenCalled();
      expect(deps.prisma.message.create).not.toHaveBeenCalled();
    });

    // 2. Human actively replying (recent lastSeenAt, i.e. not away): AI remains silent.
    // Same mechanism as #1 -- "actively replying" means present, which isAgentAway
    // treats identically to merely assigned-and-not-stale. Named separately because
    // the task lists it as its own scenario.
    it('stays silent for an actively-present human agent even when tenant-wide takeover is enabled (not away yet)', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst.mockResolvedValue({ assignedTo: PRESENT_AGENT });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, PRESENT_AGENT, /* takeoverEnabled */ true, /* aiEnabledForTenant */ true);

      expect(deps.whatsappService.sendTextMessage).not.toHaveBeenCalled();
    });

    // 3. Human takes over after a job is queued: the queued job is suppressed.
    // Calling handleAiSuggestion/handleAiAutoReply directly here already represents
    // "the queued closure is now running" (this file's own convention, see the header
    // comment) -- the recheck inside it is what must catch a since-changed assignment.
    it('suppresses a queued AI-suggestion job if a human agent is now assigned by the time it runs', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst.mockResolvedValue({ assignedTo: PRESENT_AGENT }); // ownership at run-time, not at the (unmodeled) dispatch time
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiSuggestion('t1', conversation, contact, 'hi', false, false, true);

      expect(deps.aiResponderService.generateSuggestion).not.toHaveBeenCalled();
    });

    // 4. Human takes over during AI generation: the generated reply is not delivered.
    it('discards an already-generated auto-reply if a human agent takes over while generation was in flight', async () => {
      const deps = buildDeps();
      // First call (pre-generation check) sees no assignee; second call (pre-send
      // check, after generateAiReply's await) sees a present human agent.
      deps.prisma.conversation.findFirst
        .mockResolvedValueOnce({ assignedTo: null })
        .mockResolvedValueOnce({ assignedTo: PRESENT_AGENT });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null, false, true);

      // Generation DID happen (the pre-generation check passed) -- the provider was
      // called and the spend already happened; what must not happen is delivery.
      expect(deps.aiResponderService.generateSuggestion).toHaveBeenCalled();
      expect(deps.whatsappService.sendTextMessage).not.toHaveBeenCalled();
      expect(deps.prisma.message.create).not.toHaveBeenCalled();
      expect(deps.aiLogsService.create).not.toHaveBeenCalled();
    });

    it('discards an already-generated SUGGESTION too if a human takes over mid-generation (prevents an unnecessary stored suggestion/log, not just a send)', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst
        .mockResolvedValueOnce({ assignedTo: null })
        .mockResolvedValueOnce({ assignedTo: PRESENT_AGENT });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiSuggestion('t1', conversation, contact, 'hi', false, false, true);

      expect(deps.aiLogsService.create).not.toHaveBeenCalled();
      expect(deps.realtimeService.emitAiSuggestion).not.toHaveBeenCalled();
    });

    // 5. Ownership lookup fails or is ambiguous: no AI response -- fail closed, never
    // treat a failed/ambiguous check as "safe to proceed."
    it('fails closed (suppresses AI, zero provider calls) when the ownership recheck lookup throws', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst.mockRejectedValue(new Error('db unavailable'));
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null, false, true)).resolves.toBeUndefined();

      expect(deps.aiResponderService.generateSuggestion).not.toHaveBeenCalled();
      expect(deps.whatsappService.sendTextMessage).not.toHaveBeenCalled();
    });

    it('fails closed when the ownership lookup resolves to null (conversation not found)', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst.mockResolvedValue(null);
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiSuggestion('t1', conversation, contact, 'hi', false, false, true);

      expect(deps.aiResponderService.generateSuggestion).not.toHaveBeenCalled();
    });

    // 6. Conversation legitimately returned to AI handling: existing supported
    // behavior still works -- unassigned, or assigned to the AI agent itself.
    it('proceeds normally when the conversation is unassigned', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst.mockResolvedValue({ assignedTo: null });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null, false, true);

      expect(deps.whatsappService.sendTextMessage).toHaveBeenCalled();
    });

    it('proceeds normally when the conversation is assigned to an AI agent (isAiAgent: true), never treated as human-owned', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst.mockResolvedValue({ assignedTo: { id: 'ai-agent-1', isAiAgent: true, lastSeenAt: null } });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null, false, true);

      expect(deps.whatsappService.sendTextMessage).toHaveBeenCalled();
    });

    it('proceeds (takeover) for a genuinely away human agent when the tenant has takeover enabled', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst.mockResolvedValue({ assignedTo: AWAY_AGENT });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, AWAY_AGENT, /* takeoverEnabled */ true, /* aiEnabledForTenant */ true);

      expect(deps.whatsappService.sendTextMessage).toHaveBeenCalled();
    });

    it('does NOT take over for an away agent when the tenant has not opted into takeover', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst.mockResolvedValue({ assignedTo: AWAY_AGENT });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, AWAY_AGENT, /* takeoverEnabled */ false, /* aiEnabledForTenant */ true);

      expect(deps.whatsappService.sendTextMessage).not.toHaveBeenCalled();
    });

    // 7. Legacy, v2, and Commerce paths all respect human ownership -- the guard sits
    // in handleAiSuggestion/handleAiAutoReply, upstream of generateAiReply's dispatch
    // to any of the three generator backends, so this is one fix point, not three.
    it('blocks the Commerce generator when human-handled', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst.mockResolvedValue({ assignedTo: PRESENT_AGENT });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', /* commerceEnabled */ true, PRESENT_AGENT, false, true);

      expect(deps.commerceAiService.handleMessage).not.toHaveBeenCalled();
    });

    it('blocks the v2 pipeline generator when human-handled', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst.mockResolvedValue({ assignedTo: PRESENT_AGENT });
      deps.featureFlagsService.isEnabledCached.mockResolvedValue(true);
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', /* commerceEnabled */ false, PRESENT_AGENT, false, true);

      expect(deps.verzAiPipeline.run).not.toHaveBeenCalled();
      expect(deps.aiAgentsService.findOrCreateDefaultAgent).not.toHaveBeenCalled();
    });

    it('blocks the legacy responder generator when human-handled', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst.mockResolvedValue({ assignedTo: PRESENT_AGENT });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', /* commerceEnabled */ false, PRESENT_AGENT, false, true);

      expect(deps.aiResponderService.generateSuggestion).not.toHaveBeenCalled();
    });

    // Narrows a race window: requestWithRetry is awaited AFTER the post-generation
    // check in the no-response and shouldEscalate branches, so a human can take over
    // while it is pending. Ownership call order: [pre-generation, post-generation,
    // post-handoff] -- only the third sees the human. These tests cover a takeover
    // visible in the DB at the final check; a takeover landing after that check but
    // before the provider send is NOT covered (the read and the send are not atomic).
    it('suppresses the fallback text when a human takes over while the no-response handoff request is pending', async () => {
      const deps = buildDeps();
      deps.commerceAiService.handleMessage.mockRejectedValue(new Error('provider down'));
      deps.prisma.conversation.findFirst
        .mockResolvedValueOnce({ assignedTo: null })
        .mockResolvedValueOnce({ assignedTo: null })
        .mockResolvedValueOnce({ assignedTo: PRESENT_AGENT });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', true, null, false, true);

      expect(deps.conversationsService.requestWithRetry).toHaveBeenCalled(); // the legitimate handoff request is kept
      expect(deps.whatsappService.sendTextMessage).not.toHaveBeenCalled();
      expect(deps.prisma.message.create).not.toHaveBeenCalled();
      expect(deps.aiLogsService.create).not.toHaveBeenCalled();
    });

    it('suppresses the escalation reply (and its log/persist/notify) when a human takes over while the shouldEscalate handoff request is pending', async () => {
      const deps = buildDeps();
      deps.aiResponderService.generateSuggestion.mockResolvedValue({ response: "Sure, I'll get someone.", confidence: 20, blocked: false, shouldEscalate: true });
      deps.prisma.conversation.findFirst
        .mockResolvedValueOnce({ assignedTo: null })
        .mockResolvedValueOnce({ assignedTo: null })
        .mockResolvedValueOnce({ assignedTo: PRESENT_AGENT });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null, false, true);

      expect(deps.conversationsService.requestWithRetry).toHaveBeenCalled();
      expect(deps.whatsappService.sendTextMessage).not.toHaveBeenCalled();
      expect(deps.prisma.message.create).not.toHaveBeenCalled();
      expect(deps.aiLogsService.create).not.toHaveBeenCalled();
      expect(deps.realtimeService.emitNewMessage).not.toHaveBeenCalled();
    });

    it('fails closed on the post-handoff recheck too (lookup error => no escalation reply sent)', async () => {
      const deps = buildDeps();
      deps.aiResponderService.generateSuggestion.mockResolvedValue({ response: 'ok', confidence: 20, blocked: false, shouldEscalate: true });
      deps.prisma.conversation.findFirst
        .mockResolvedValueOnce({ assignedTo: null })
        .mockResolvedValueOnce({ assignedTo: null })
        .mockRejectedValueOnce(new Error('db blip'));
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null, false, true);

      expect(deps.whatsappService.sendTextMessage).not.toHaveBeenCalled();
    });

    it('still delivers the escalation reply when ownership is unchanged after the handoff request (legitimate handoff preserved)', async () => {
      const deps = buildDeps();
      deps.aiResponderService.generateSuggestion.mockResolvedValue({ response: "Sure, I'll get someone.", confidence: 20, blocked: false, shouldEscalate: true });
      const service = buildService(deps); // default mock: never human-owned

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null, false, true);

      expect(deps.whatsappService.sendTextMessage).toHaveBeenCalledWith('t1', contact.phone, "Sure, I'll get someone.", undefined, undefined);
    });

    // ---- Delivery-time protections (this round) ----

    it('takeover immediately before delivery: the final ownership read happens AFTER generation and BEFORE the provider send, with nothing awaited in between on the normal path', async () => {
      const deps = buildDeps();
      const events: string[] = [];
      deps.prisma.conversation.findFirst.mockImplementation(async () => { events.push('ownership-check'); return { assignedTo: null }; });
      deps.aiResponderService.generateSuggestion.mockImplementation(async () => { events.push('generate'); return { response: 'Hi there', confidence: 80, blocked: false }; });
      deps.whatsappService.sendTextMessage.mockImplementation(async () => { events.push('send'); return 'wamid.1'; });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null, false, true);

      expect(events).toEqual(['ownership-check', 'generate', 'ownership-check', 'send']);
    });

    it('does not overwrite a human who took over before the self-assign: the claim is a conditional UPDATE (assigned_to_id IS NULL, tenant-scoped) and a lost race emits nothing', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.updateMany.mockResolvedValue({ count: 0 }); // a human assigned themselves first
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, null, false, true);

      expect(deps.prisma.conversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'conv1', tenantId: 't1', assignedToId: null },
      }));
      expect(deps.prisma.conversation.update).not.toHaveBeenCalled(); // the old unconditional write is gone
      expect(deps.realtimeService.emitConversationUpdated).not.toHaveBeenCalled();
    });

    it('stops AI-triggered media sends if a human takes over after the text reply (rechecked before each media item)', async () => {
      const deps = buildDeps();
      deps.commerceAiService.handleMessage.mockResolvedValue({
        response: 'Here you go', blocked: false, toolTrace: [],
        mediaToSend: [
          { type: 'send_media', mediaUrl: '/api/v1/media/serve/products/1.jpg', mediaType: 'IMAGE', caption: 'one', productId: 'p1' },
          { type: 'send_media', mediaUrl: '/api/v1/media/serve/products/2.jpg', mediaType: 'IMAGE', caption: 'two', productId: 'p2' },
        ],
      });
      // checks: pre-generation, post-generation, media #1 (all clear), media #2 (human took over)
      deps.prisma.conversation.findFirst
        .mockResolvedValueOnce({ assignedTo: null })
        .mockResolvedValueOnce({ assignedTo: null })
        .mockResolvedValueOnce({ assignedTo: null })
        .mockResolvedValueOnce({ assignedTo: PRESENT_AGENT });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'pics', true, null, false, true);

      expect(deps.whatsappService.sendTextMessage).toHaveBeenCalledTimes(1);
      expect(deps.whatsappService.sendMediaMessageById).toHaveBeenCalledTimes(1); // only the first image
    });

    it('concurrent delivery attempts for one conversation are serialized, and the second turn sees a takeover that happened during the first', async () => {
      const deps = buildDeps();
      let humanTookOver = false;
      deps.prisma.conversation.findFirst.mockImplementation(async () => ({ assignedTo: humanTookOver ? PRESENT_AGENT : null }));
      let inFlight = 0; let maxInFlight = 0;
      deps.whatsappService.sendTextMessage.mockImplementation(async () => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        humanTookOver = true; // the human grabs the chat while the first send is in flight
        inFlight--;
        return 'wamid.1';
      });
      const service = buildService(deps);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = service as any;

      await Promise.all([
        svc.runExclusiveForConversation('conv1', () => svc.handleAiAutoReply('t1', conversation, contact, 'one', false, null, false, true)),
        svc.runExclusiveForConversation('conv1', () => svc.handleAiAutoReply('t1', conversation, contact, 'two', false, null, false, true)),
      ]);

      expect(maxInFlight).toBe(1);
      expect(deps.whatsappService.sendTextMessage).toHaveBeenCalledTimes(1); // second turn suppressed
    });

    // ---- maybeScoreLead gating ----

    it('does not trigger lead scoring (a paid LLM call) for a human-handled conversation', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst.mockResolvedValue({ assignedTo: PRESENT_AGENT });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', true, PRESENT_AGENT, false, true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiSuggestion('t1', conversation, contact, 'hi', true, false, true);

      expect(deps.leadsService.scoreConversation).not.toHaveBeenCalled();
    });

    it('does not trigger lead scoring when the ownership lookup fails (fail closed)', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst.mockRejectedValue(new Error('db down'));
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', true, null, false, true);

      expect(deps.leadsService.scoreConversation).not.toHaveBeenCalled();
    });

    it('still scores the lead for a legitimately AI-managed commerce conversation (unassigned, or assigned to the AI agent)', async () => {
      for (const assignedTo of [null, { id: 'ai-1', isAiAgent: true, lastSeenAt: null }]) {
        const deps = buildDeps();
        deps.prisma.conversation.findFirst.mockResolvedValue({ assignedTo });
        const service = buildService(deps);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', true, null, false, true);

        expect(deps.leadsService.scoreConversation).toHaveBeenCalledWith('t1', 'conv1', 'contact1');
      }
    });

    // 8. Background retry or duplicate event: ownership is rechecked before work
    // proceeds -- a second queued turn for the same conversation must not reuse the
    // first turn's (now stale) ownership conclusion.
    it('rechecks ownership independently for each of two sequential queued turns on the same conversation', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.findFirst
        .mockResolvedValueOnce({ assignedTo: null }) // first turn: unowned, AI proceeds
        .mockResolvedValueOnce({ assignedTo: PRESENT_AGENT }); // second turn (e.g. a retry/duplicate): now human-owned, AI must suppress
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = service as any;
      await svc.runExclusiveForConversation('conv1', () => svc.handleAiAutoReply('t1', conversation, contact, 'hi', false, null, false, true));
      await svc.runExclusiveForConversation('conv1', () => svc.handleAiAutoReply('t1', conversation, contact, 'hi', false, null, false, true));

      expect(deps.whatsappService.sendTextMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('runExclusiveForConversation (Verz-AI unification, Phase M)', () => {
    it('runs same-conversation turns strictly one after another, never overlapping', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      const order: string[] = [];
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const makeTurn = (label: string, delayMs: number) => async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        order.push(`start:${label}`);
        await new Promise((r) => setTimeout(r, delayMs));
        order.push(`end:${label}`);
        concurrentCount--;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = service as any;
      await Promise.all([
        svc.runExclusiveForConversation('conv1', makeTurn('a', 20)),
        svc.runExclusiveForConversation('conv1', makeTurn('b', 5)),
      ]);

      expect(maxConcurrent).toBe(1);
      expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
    });

    it('lets different conversations run concurrently -- the lock is per-conversation, not global', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const makeTurn = (delayMs: number) => async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise((r) => setTimeout(r, delayMs));
        concurrentCount--;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = service as any;
      await Promise.all([
        svc.runExclusiveForConversation('conv1', makeTurn(20)),
        svc.runExclusiveForConversation('conv2', makeTurn(20)),
      ]);

      expect(maxConcurrent).toBe(2);
    });

    it('still runs the next queued turn even if the previous one throws', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      const ran: string[] = [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = service as any;
      const first = svc.runExclusiveForConversation('conv1', async () => {
        ran.push('first');
        throw new Error('boom');
      });
      const second = svc.runExclusiveForConversation('conv1', async () => {
        ran.push('second');
      });

      await expect(first).rejects.toThrow('boom');
      await expect(second).resolves.toBeUndefined();
      expect(ran).toEqual(['first', 'second']);
    });
  });

  describe('handleInboundWhatsAppWeb (unofficial QR/linked-device channel)', () => {
    it('is idempotent: a providerMessageId already seen for this tenant short-circuits without creating a new contact/conversation/message', async () => {
      const deps = buildDeps();
      deps.prisma.message.findFirst.mockResolvedValue({ id: 'existing-msg' });
      const service = buildService(deps);

      const result = await service.handleInboundWhatsAppWeb('t1', 'chan1', '+233555000111', 'wa-msg-1', { content: 'hi' });

      expect(result).toEqual({ id: 'existing-msg' });
      expect(deps.contactsService.findOrCreate).not.toHaveBeenCalled();
      expect(deps.conversationsService.findOrCreate).not.toHaveBeenCalled();
      expect(deps.prisma.message.create).not.toHaveBeenCalled();
    });

    it('scopes the duplicate-check to the calling tenant -- same providerMessageId, different tenant, is not treated as a duplicate', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, 'dispatchAiAndChatbot').mockResolvedValue(undefined);

      await service.handleInboundWhatsAppWeb('tenant-a', 'chan1', '+233555000111', 'wa-msg-1', { content: 'hi' });

      expect(deps.prisma.message.findFirst).toHaveBeenCalledWith({
        where: { whatsappMessageId: 'wa-msg-1', tenantId: 'tenant-a' },
        select: { id: true },
      });
    });

    it('creates the contact/conversation/message and emits realtime events for a new inbound message', async () => {
      const deps = buildDeps();
      deps.prisma.message.create.mockResolvedValue({ id: 'msg-new', createdAt: new Date('2026-01-01') });
      const service = buildService(deps);
      // dispatchAiAndChatbot is exercised by the other describe blocks above via its
      // own extracted methods -- stub it here so this test stays focused on the
      // contact/conversation/message/realtime plumbing that's unique to this entry point.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, 'dispatchAiAndChatbot').mockResolvedValue(undefined);

      const result = await service.handleInboundWhatsAppWeb('t1', 'chan1', '+233555000111', 'wa-msg-2', { content: 'Hello!' }, 'Jane Doe');

      expect(deps.contactsService.findOrCreate).toHaveBeenCalledWith('t1', '+233555000111', 'Jane Doe');
      expect(deps.conversationsService.findOrCreate).toHaveBeenCalledWith('t1', 'contact1', undefined, undefined, 'chan1');
      expect(deps.prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 't1', whatsappMessageId: 'wa-msg-2', channelId: 'chan1',
          direction: 'INBOUND', content: 'Hello!',
        }),
      }));
      expect(deps.realtimeService.emitNewMessage).toHaveBeenCalledWith('t1', 'conv1', expect.objectContaining({ id: 'msg-new' }));
      expect(result).toEqual(expect.objectContaining({ id: 'msg-new' }));
    });

    it('falls back to a placeholder when neither text content nor a downloadable media URL is present', async () => {
      const deps = buildDeps();
      deps.prisma.message.create.mockResolvedValue({ id: 'msg-placeholder', createdAt: new Date('2026-01-01') });
      const service = buildService(deps);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, 'dispatchAiAndChatbot').mockResolvedValue(undefined);

      await service.handleInboundWhatsAppWeb('t1', 'chan1', '+233555000111', 'wa-msg-3', {});

      expect(deps.prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ content: "[Sent a message type we can't display yet]" }),
      }));
    });
  });

  describe('handleInbound (real WhatsApp Cloud API webhook path) -- button/interactive content population', () => {
    it('extracts the tapped Quick Reply button text as content instead of falling into the unsupported-type placeholder', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      await service.handleInbound('t1', {
        id: 'wamid.button-1', from: '+233555000111', timestamp: '1700000000', type: 'button',
        button: { payload: 'ORDER_STATUS', text: 'Check order status' },
      });

      expect(deps.prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ content: 'Check order status', type: 'TEXT' }),
      }));
    });

    it('extracts a non-CSAT interactive list_reply title as content instead of leaving it empty', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      await service.handleInbound('t1', {
        id: 'wamid.interactive-1', from: '+233555000111', timestamp: '1700000000', type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: 'opt_2', title: 'Track my package' } },
      });

      expect(deps.prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ content: 'Track my package' }),
      }));
    });

    it('extracts a non-CSAT interactive button_reply title as content', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      await service.handleInbound('t1', {
        id: 'wamid.interactive-2', from: '+233555000111', timestamp: '1700000000', type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'btn_yes', title: 'Yes, please' } },
      });

      expect(deps.prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ content: 'Yes, please' }),
      }));
    });
  });

  describe('handleInbound (real WhatsApp Cloud API webhook path) -- Business-Scoped User ID fallback', () => {
    it('resolves the contact by from_user_id instead of dropping the message when "from" is omitted', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      await service.handleInbound('t1', {
        id: 'wamid.bsuid-1', timestamp: '1700000000', type: 'text',
        text: { body: 'Hello! Can I get more info on this?' },
        from_user_id: 'GH.1115168874544553',
      } as any);

      expect(deps.contactsService.findOrCreate).toHaveBeenCalledWith('t1', 'GH.1115168874544553', undefined);
      expect(deps.prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ content: 'Hello! Can I get more info on this?' }),
      }));
    });

    it('still skips a message with neither "from" nor "from_user_id"', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      const result = await service.handleInbound('t1', {
        id: 'wamid.malformed-1', timestamp: '1700000000', type: 'text', text: { body: 'hi' },
      } as any);

      expect(result).toBeNull();
      expect(deps.contactsService.findOrCreate).not.toHaveBeenCalled();
      expect(deps.prisma.message.create).not.toHaveBeenCalled();
    });
  });
});
