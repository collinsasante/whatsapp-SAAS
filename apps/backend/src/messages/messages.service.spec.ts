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
      tenantSettings: { findUnique: jest.fn() },
      tenant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      message: { create: jest.fn().mockResolvedValue({ id: 'msg-1' }) },
      conversation: { update: jest.fn().mockResolvedValue({ id: 'conv1' }) },
    },
    whatsappService: { sendTextMessage: jest.fn().mockResolvedValue(undefined) },
    conversationsService: { request: jest.fn().mockResolvedValue(null) },
    contactsService: {},
    realtimeService: { emitAiSuggestion: jest.fn(), emitNewMessage: jest.fn(), emitConversationUpdated: jest.fn() },
    storageService: {},
    chatbotFlowsService: {},
    activityLogService: {},
    aiResponderService: {
      findOrCreateVerzAgent: jest.fn().mockResolvedValue({ id: 'agent-1', name: 'Verz', avatarUrl: null }),
      generateSuggestion: jest.fn().mockResolvedValue({ response: 'Hi there', confidence: 80, blocked: false }),
      shouldRespond: jest.fn().mockResolvedValue(true),
      getMode: jest.fn(),
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
    },
  };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  return new MessagesService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deps.prisma as any, deps.whatsappService as any, deps.conversationsService as any, deps.contactsService as any,
    deps.realtimeService as any, deps.storageService as any, deps.chatbotFlowsService as any, deps.activityLogService as any,
    deps.aiResponderService as any, deps.knowledgeBaseService as any, deps.aiLogsService as any, deps.commerceAiService as any,
    deps.featureFlagsService as any, deps.aiAgentsService as any, deps.verzAiPipeline as any, deps.aiExecutionsService as any,
    deps.leadsService as any, deps.aiCreditsService as any,
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

      expect(deps.aiResponderService.generateSuggestion).toHaveBeenCalledWith('t1', 'conv1', 'hi', 'Jane');
      expect(result).toEqual({ response: 'Hi there', confidence: 80, blocked: false, executionId: null });
    });

    it('charges a flat estimated credit amount for the legacy responder, since it has no real token tracking', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).generateAiReply('t1', 'conv1', 'contact1', '+233555000111', 'hi', 'Jane', { commerceEnabled: false, readOnlyTools: false });

      expect(deps.aiCreditsService.chargeFlat).toHaveBeenCalledWith('t1', expect.any(Number), 'Legacy AI responder usage');
    });

    it('does not charge the legacy flat amount when the legacy responder produced no response', async () => {
      const deps = buildDeps();
      deps.aiResponderService.generateSuggestion.mockResolvedValue({ response: '', confidence: null, blocked: false });
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).generateAiReply('t1', 'conv1', 'contact1', '+233555000111', 'hi', 'Jane', { commerceEnabled: false, readOnlyTools: false });

      expect(deps.aiCreditsService.chargeFlat).not.toHaveBeenCalled();
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

      expect(deps.commerceAiService.handleMessage).toHaveBeenCalledWith('t1', 'conv1', 'contact1', '+233555000111', 'hi', 'Jane', undefined, { readOnlyTools: true });
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

      expect(deps.conversationsService.request).toHaveBeenCalledWith('t1', 'conv1', expect.any(String));
    });

    it('degrades gracefully when the generator rejects, without throwing', async () => {
      const deps = buildDeps();
      deps.commerceAiService.handleMessage.mockRejectedValue(new Error('provider down'));
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((service as any).handleAiSuggestion('t1', conversation, contact, 'hi', true)).resolves.toBeUndefined();
      expect(deps.aiLogsService.create).not.toHaveBeenCalled();
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
    it('sends, persists with commerce:true metadata, and logs AUTO_SENT when commerceEnabled', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', true, null);

      expect(deps.commerceAiService.handleMessage).toHaveBeenCalledWith('t1', 'conv1', 'contact1', '+233555000111', 'hi', 'Jane', undefined, { readOnlyTools: false });
      expect(deps.whatsappService.sendTextMessage).toHaveBeenCalledWith('t1', '+233555000111', 'We have that in stock.');
      expect(deps.prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: { aiGenerated: true, commerce: true } }) }));
      expect(deps.aiLogsService.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'AUTO_SENT' }));
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

      expect(deps.prisma.conversation.update).toHaveBeenCalledWith({ where: { id: 'conv1' }, data: { assignedToId: 'agent-1', status: 'OPEN' } });
      expect(deps.realtimeService.emitConversationUpdated).toHaveBeenCalled();
      expect(deps.realtimeService.emitNewMessage).toHaveBeenCalledWith('t1', 'conv1', { id: 'msg-1' });
    });

    it('skips self-assignment when the conversation is already assigned', async () => {
      const deps = buildDeps();
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).handleAiAutoReply('t1', conversation, contact, 'hi', false, { id: 'human-1', isAiAgent: false });

      expect(deps.prisma.conversation.update).not.toHaveBeenCalled();
      expect(deps.realtimeService.emitConversationUpdated).not.toHaveBeenCalled();
      expect(deps.realtimeService.emitNewMessage).toHaveBeenCalled();
    });

    it('does not emit conversationUpdated when the self-assign write fails', async () => {
      const deps = buildDeps();
      deps.prisma.conversation.update.mockRejectedValue(new Error('db down'));
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

      expect(deps.conversationsService.request).toHaveBeenCalledWith('t1', 'conv1', expect.any(String));
    });

    it('degrades gracefully when the generator rejects, without throwing', async () => {
      const deps = buildDeps();
      deps.commerceAiService.handleMessage.mockRejectedValue(new Error('provider down'));
      const service = buildService(deps);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((service as any).handleAiAutoReply('t1', conversation, contact, 'hi', true, null)).resolves.toBeUndefined();
      expect(deps.whatsappService.sendTextMessage).not.toHaveBeenCalled();
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
});
