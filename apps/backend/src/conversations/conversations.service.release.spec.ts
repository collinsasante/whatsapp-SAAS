import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

type Owner = { id: string; isAiAgent: boolean } | null;

function build(opts: {
  status?: string; owner?: Owner; assignedToId?: string | null; updateCount?: number;
  mode?: 'SUGGESTION' | 'AUTO_REPLY' | null; availability?: { available: boolean; reason: string | null };
}) {
  const existing = {
    id: 'c1', tenantId: 't1', contactId: 'ct1', status: opts.status ?? 'INTERVENED',
    assignedTo: opts.owner === undefined ? { id: 'agent-1', isAiAgent: false } : opts.owner,
    assignedToId: opts.assignedToId === undefined ? (opts.owner === null ? null : (opts.owner?.id ?? 'agent-1')) : opts.assignedToId,
  };
  const prisma = { conversation: { updateMany: jest.fn().mockResolvedValue({ count: opts.updateCount ?? 1 }) } };
  const ai = {
    findOrCreateVerzAgent: jest.fn().mockResolvedValue({ id: 'verz-ai' }),
    getMode: jest.fn().mockResolvedValue(opts.mode === undefined ? 'AUTO_REPLY' : opts.mode),
    evaluateAvailability: jest.fn().mockResolvedValue(opts.availability ?? { available: true, reason: null }),
  };
  const svc = Object.create(ConversationsService.prototype) as Record<string, unknown>;
  Object.assign(svc, {
    prisma,
    moduleRef: { get: jest.fn().mockReturnValue(ai) },
    findOne: jest.fn().mockResolvedValueOnce(existing).mockResolvedValue({ ...existing, status: 'OPEN', assignedTo: { id: 'verz-ai', isAiAgent: true } }),
    recordEvent: jest.fn().mockResolvedValue(undefined),
    activityLogService: { log: jest.fn() },
    realtimeService: { emitConversationStateChanged: jest.fn() },
  });
  return { svc: svc as unknown as ConversationsService, prisma, ai, recordEvent: svc['recordEvent'] as jest.Mock, realtime: (svc['realtimeService'] as { emitConversationStateChanged: jest.Mock }) };
}

describe('ConversationsService.releaseToAi', () => {
  it('hands a human-owned chat to the AI agent with a compare-and-set scoped to the tenant', async () => {
    const { svc, prisma, recordEvent, realtime } = build({});
    const result = await svc.releaseToAi('t1', 'c1', 'agent-1', 'AGENT');
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', tenantId: 't1', assignedToId: 'agent-1' },
      data: expect.objectContaining({ assignedToId: 'verz-ai', status: 'OPEN', intervenedAt: null }),
    });
    expect(recordEvent).toHaveBeenCalledWith('t1', 'c1', 'BOT_RESUMED', 'agent-1', expect.objectContaining({ returnedToAi: true, previousAssigneeId: 'agent-1' }));
    expect(realtime.emitConversationStateChanged).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ aiHandling: { mode: 'AUTO_REPLY', willAutoReply: true, reason: null } });
  });

  it('does not let one agent hand back a chat another human agent is handling, but allows an admin', async () => {
    const a = build({ owner: { id: 'someone-else', isAiAgent: false } });
    await expect(a.svc.releaseToAi('t1', 'c1', 'agent-1', 'AGENT')).rejects.toThrow(ForbiddenException);
    expect(a.prisma.conversation.updateMany).not.toHaveBeenCalled();
    const b = build({ owner: { id: 'someone-else', isAiAgent: false } });
    await expect(b.svc.releaseToAi('t1', 'c1', 'boss', 'ADMIN')).resolves.toBeDefined();
  });

  it('refuses a resolved conversation instead of silently reopening it', async () => {
    const { svc, prisma } = build({ status: 'RESOLVED' });
    await expect(svc.releaseToAi('t1', 'c1', 'agent-1', 'AGENT')).rejects.toThrow(BadRequestException);
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('reports a conflict, without overwriting, when ownership changed after it was read', async () => {
    const { svc, recordEvent } = build({ updateCount: 0 });
    await expect(svc.releaseToAi('t1', 'c1', 'agent-1', 'AGENT')).rejects.toThrow(ConflictException);
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('is idempotent when the AI already owns the chat (no write, no duplicate audit event)', async () => {
    const { svc, prisma, recordEvent } = build({ status: 'OPEN', owner: { id: 'verz-ai', isAiAgent: true } });
    const result = await svc.releaseToAi('t1', 'c1', 'agent-1', 'AGENT');
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
    expect(recordEvent).not.toHaveBeenCalled();
    expect(result).toHaveProperty('aiHandling');
  });

  it('releases an unassigned chat (compare-and-set on null)', async () => {
    const { svc, prisma } = build({ owner: null, status: 'REQUESTED' });
    await svc.releaseToAi('t1', 'c1', 'agent-1', 'AGENT');
    expect(prisma.conversation.updateMany.mock.calls[0][0].where).toEqual({ id: 'c1', tenantId: 't1', assignedToId: null });
  });

  describe('tells the agent what the AI will actually do', () => {
    it('auto-reply mode and available: it will reply', async () => {
      const r = await build({ mode: 'AUTO_REPLY' }).svc.releaseToAi('t1', 'c1', 'agent-1', 'AGENT');
      expect(r.aiHandling).toEqual({ mode: 'AUTO_REPLY', willAutoReply: true, reason: null });
    });
    it('suggestion mode: it only drafts replies', async () => {
      const r = await build({ mode: 'SUGGESTION' }).svc.releaseToAi('t1', 'c1', 'agent-1', 'AGENT');
      expect(r.aiHandling).toMatchObject({ mode: 'SUGGESTION', willAutoReply: false });
    });
    it('AI switched off', async () => {
      const r = await build({ mode: null, availability: { available: false, reason: 'AI_DISABLED' } }).svc.releaseToAi('t1', 'c1', 'agent-1', 'AGENT');
      expect(r.aiHandling).toEqual({ mode: null, willAutoReply: false, reason: 'AI_DISABLED' });
    });
    it('auto-reply mode but outside the configured schedule', async () => {
      const r = await build({ mode: 'AUTO_REPLY', availability: { available: false, reason: 'OUTSIDE_SCHEDULE' } }).svc.releaseToAi('t1', 'c1', 'agent-1', 'AGENT');
      expect(r.aiHandling).toEqual({ mode: 'AUTO_REPLY', willAutoReply: false, reason: 'OUTSIDE_SCHEDULE' });
    });
    it('no credits', async () => {
      const r = await build({ mode: 'AUTO_REPLY', availability: { available: false, reason: 'NO_CREDITS' } }).svc.releaseToAi('t1', 'c1', 'agent-1', 'AGENT');
      expect(r.aiHandling.reason).toBe('NO_CREDITS');
    });
  });
});
