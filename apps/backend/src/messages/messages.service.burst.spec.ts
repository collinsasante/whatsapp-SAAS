import { MessagesService } from './messages.service';

/**
 * Rapid-fire customer messages through the REAL per-conversation turn queue and the REAL auto-reply / suggestion handlers. Only the
 * model call, the channel send and the database writes around them are stubbed, so what is under test is the decision itself:
 * which turns generate, which replies are sent, and that nothing is lost.
 */
function setup() {
  const sent: string[] = [];
  const generated: string[] = [];
  const gates = new Map<string, () => void>();
  const prisma = { message: { create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'm', ...data })) }, conversation: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) } };
  const args: unknown[] = new Array(22).fill({});
  args[0] = prisma;
  // Any realtime event is a no-op that can be asserted on.
  const fns: Record<string, jest.Mock> = {};
  args[4] = new Proxy({}, { get: (_t, key: string) => (fns[key] ??= jest.fn()) });
  args[8] = { findOrCreateVerzAgent: jest.fn().mockResolvedValue({ id: 'verz' }), shouldRespond: jest.fn().mockResolvedValue(true) };
  args[10] = { create: jest.fn().mockResolvedValue({ id: 'log-1' }) };
  args[15] = { linkInteractionLog: jest.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new (MessagesService as any)(...args) as any;
  service.isConversationHumanHandled = jest.fn().mockResolvedValue(false);
  service.maybeScoreLead = jest.fn();
  service.requestHandoff = jest.fn().mockResolvedValue(true);
  service.sendAiText = jest.fn(async (_t: string, _c: unknown, _k: unknown, text: string) => { sent.push(text); return { fields: {}, whatsappMessageId: 'w' }; });
  /** The model "takes time": each message's generation finishes only when the test releases it. */
  const modelResult: Record<string, Partial<{ toolTrace: Array<{ name: string }>; shouldEscalate: boolean }>> = {};
  service.generateAiReply = jest.fn((_t: string, _c: string, _k: string, _p: string, content: string) => {
    generated.push(content);
    return new Promise((resolve) => {
      gates.set(content, () => resolve({ response: `reply to: ${content}`, confidence: 90, blocked: false, executionId: null, ...modelResult[content] }));
    });
  });
  const turn = (conversationId: string, content: string, mode: 'auto' | 'suggest' = 'auto') =>
    service.runExclusiveForConversation(conversationId, () =>
      mode === 'auto'
        ? service.handleAiAutoReply('t1', { id: conversationId }, { id: 'ct1', phone: '+233555000111', name: 'Abena' }, content, false, null, false, true, `msg-${content}`)
        : service.handleAiSuggestion('t1', { id: conversationId }, { id: 'ct1', phone: '+233555000111', name: 'Abena' }, content, false, false, true, `msg-${content}`),
    ) as Promise<void>;
  const release = (content: string) => gates.get(content)?.();
  const tick = () => new Promise((r) => setTimeout(r, 10));
  return { service, sent, generated, turn, release, tick, modelResult };
}

describe('rapid-fire messages', () => {
  it('answers a burst of three messages once, with the whole burst in view, instead of three times', async () => {
    const { sent, generated, turn, release, tick } = setup();
    const first = turn('c1', 'hi');
    await tick(); // turn 1 is generating
    const second = turn('c1', 'i want a shirt');
    const third = turn('c1', 'the red one');
    release('hi');
    await first;
    await tick();
    release('the red one');
    await Promise.all([second, third]);

    expect(generated).toEqual(['hi', 'the red one']); // the middle message never reached the model: no cost, no half-answer
    expect(sent).toEqual(['reply to: the red one']); // and the answer to "hi" alone was not sent
  });

  it('does not change the ordinary case: one message, one reply', async () => {
    const { sent, turn, release, tick } = setup();
    const only = turn('c1', 'how much is the red shirt');
    await tick();
    release('how much is the red shirt');
    await only;
    expect(sent).toEqual(['reply to: how much is the red shirt']);
  });

  it('answers each message when they are not in a burst (the first reply is already out before the second arrives)', async () => {
    const { sent, turn, release, tick } = setup();
    const first = turn('c1', 'hi');
    await tick();
    release('hi');
    await first;
    const second = turn('c1', 'how much is the red shirt');
    await tick();
    release('how much is the red shirt');
    await second;
    expect(sent).toEqual(['reply to: hi', 'reply to: how much is the red shirt']);
  });

  it('never drops a request for a person that is followed by another message', async () => {
    const { service, sent, generated, turn, release, tick, modelResult } = setup();
    modelResult['i need to talk to someone'] = { shouldEscalate: true };
    const a = turn('c1', 'hi');
    await tick();
    const b = turn('c1', 'i need to talk to someone');
    const c = turn('c1', 'hello?');
    release('hi');
    await a;
    await tick();
    expect(generated).toContain('i need to talk to someone'); // reached the model despite a newer message being queued
    release('i need to talk to someone');
    await b;
    await tick();
    release('hello?');
    await c;
    expect(service.requestHandoff).toHaveBeenCalled();
    expect(sent).toContain('reply to: i need to talk to someone');
  });

  it('still sends a reply whose turn changed something (an order, a delivery, a picture) even though a newer message is queued', async () => {
    const { sent, turn, release, tick, modelResult } = setup();
    modelResult['add two red shirts'] = { toolTrace: [{ name: 'search_products' }, { name: 'add_item_to_order' }] };
    const first = turn('c1', 'add two red shirts');
    await tick();
    const second = turn('c1', 'and a blue one');
    release('add two red shirts');
    await first;
    await tick();
    release('and a blue one');
    await second;
    expect(sent).toEqual(['reply to: add two red shirts', 'reply to: and a blue one']); // the customer is told what was done
  });

  it('still sends a reply that only looked something up when nothing newer is waiting, and drops it when something is', async () => {
    const { sent, turn, release, tick, modelResult } = setup();
    modelResult['how much is the red shirt'] = { toolTrace: [{ name: 'search_products' }] };
    const lone = turn('c1', 'how much is the red shirt');
    await tick();
    release('how much is the red shirt');
    await lone;
    expect(sent).toEqual(['reply to: how much is the red shirt']);

    sent.length = 0;
    const a = turn('c2', 'how much is the red shirt');
    await tick();
    const b = turn('c2', 'and the blue one?');
    release('how much is the red shirt');
    await a;
    await tick();
    release('and the blue one?');
    await b;
    expect(sent).toEqual(['reply to: and the blue one?']);
  });

  it('keeps conversations independent: a burst in one never suppresses another', async () => {
    const { sent, turn, release, tick } = setup();
    const a1 = turn('c1', 'hi from c1');
    const b1 = turn('c2', 'hi from c2');
    await tick();
    release('hi from c1');
    release('hi from c2');
    await Promise.all([a1, b1]);
    expect(sent.sort()).toEqual(['reply to: hi from c1', 'reply to: hi from c2']);
  });

  it('forgets a finished burst, including when a turn throws, so the next message is answered normally', async () => {
    const { service, sent, turn, release, tick } = setup();
    service.generateAiReply.mockImplementationOnce(() => Promise.reject(new Error('provider down')));
    await turn('c1', 'first').catch(() => undefined);
    expect(service.conversationAiTurns.size).toBe(0);
    const next = turn('c1', 'second');
    await tick();
    release('second');
    await next;
    expect(service.conversationAiTurns.size).toBe(0);
    expect(sent).toContain('reply to: second');
  });

  it('applies the same rule to suggestion mode: only the suggestion for the whole burst is surfaced', async () => {
    const { service, generated, turn, release, tick } = setup();
    const first = turn('c1', 'hi', 'suggest');
    await tick();
    const second = turn('c1', 'i want a shirt', 'suggest');
    release('hi');
    await first;
    await tick();
    release('i want a shirt');
    await second;
    expect(generated).toEqual(['hi', 'i want a shirt']);
    expect(service.realtimeService.emitAiSuggestion).toHaveBeenCalledTimes(1);
    expect(service.realtimeService.emitAiSuggestion.mock.calls[0][2].response).toBe('reply to: i want a shirt');
  });
});
