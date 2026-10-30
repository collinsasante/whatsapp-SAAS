import { DigitalSelfLearningService } from './digital-self-learning.service';
import { DigitalSelfLearningProcessor } from './digital-self-learning.processor';
import { DigitalSelfLearningTrigger, learnJobId } from './digital-self-learning.trigger';

type Msg = { tenantId: string; direction: string; type: string; senderId: string | null; templateId: string | null; content: string | null; metadata: unknown; sender: { isAiAgent: boolean } | null };
const human = (over: Partial<Msg> = {}): Msg => ({ tenantId: 't1', direction: 'OUTBOUND', type: 'TEXT', senderId: 'ama', templateId: null, content: "Hello! I'd be happy to help 😊 Which size do you need?", metadata: null, sender: { isAiAgent: false }, ...over });

function build(opts: { message?: Msg | null; self?: Record<string, unknown>; canned?: boolean; ledger?: boolean } = {}) {
  const self = { id: 'ds1', tenantId: 't1', userId: 'ama', enabled: true, learningPaused: false, evidenceCount: 0, profile: {}, ...opts.self };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    digitalSelfLearningEvent: { findUnique: jest.fn().mockResolvedValue(opts.ledger ? { id: 'e' } : null), create: jest.fn().mockResolvedValue({}) },
    digitalSelf: { findUniqueOrThrow: jest.fn().mockResolvedValue(self), update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    message: { findFirst: jest.fn().mockResolvedValue(opts.message === undefined ? human() : opts.message) },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'ama' }) },
    digitalSelf: { createMany: jest.fn().mockResolvedValue({ count: 0 }), findUnique: jest.fn().mockResolvedValue(self), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    cannedResponse: { findFirst: jest.fn().mockResolvedValue(opts.canned ? { id: 'c' } : null) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { svc: new DigitalSelfLearningService(prisma as never), prisma, tx };
}

describe('DigitalSelfLearningService.learnFromMessage', () => {
  it('learns from a human agent reply: one ledger row, evidence +1, profile updated, status derived', async () => {
    const { svc, tx } = build();
    expect(await svc.learnFromMessage('t1', 'm1')).toBe('learned');
    expect(tx.digitalSelfLearningEvent.create).toHaveBeenCalledWith({ data: { tenantId: 't1', digitalSelfId: 'ds1', messageId: 'm1' } });
    const data = tx.digitalSelf.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ evidenceCount: 1, lastError: null, status: 'LEARNING', profileVersion: { increment: 1 } });
    expect(data.profile.samples).toBe(1);
    expect(JSON.stringify(data.profile)).not.toMatch(/happy to help/);
  });

  it('takes a row lock before reading, so concurrent replies cannot lose an update', async () => {
    const { svc, tx } = build();
    await svc.learnFromMessage('t1', 'm1');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.digitalSelf.findUniqueOrThrow.mock.invocationCallOrder[0]);
  });

  it('ignores a message it has already learned from (redelivery does not distort the profile)', async () => {
    const { svc, tx } = build({ ledger: true });
    expect(await svc.learnFromMessage('t1', 'm1')).toBe('duplicate');
    expect(tx.digitalSelf.update).not.toHaveBeenCalled();
  });

  it.each([
    ['an AI reply', human({ sender: { isAiAgent: true } })],
    ['an AI reply with no sender', human({ senderId: null, sender: null })],
    ['a customer message', human({ direction: 'INBOUND' })],
    ['a template', human({ templateId: 'tpl' })],
    ['a missing message (or another tenant\'s id)', null],
  ])('does not learn from %s', async (_label, message) => {
    const { svc, tx } = build({ message: message as Msg | null });
    expect(await svc.learnFromMessage('t1', 'm1')).toBe('ineligible');
    expect(tx.digitalSelf.update).not.toHaveBeenCalled();
  });

  it('does not learn from a pasted saved reply', async () => {
    const { svc, tx } = build({ canned: true });
    expect(await svc.learnFromMessage('t1', 'm1')).toBe('ineligible');
    expect(tx.digitalSelf.update).not.toHaveBeenCalled();
  });

  it('does not learn while learning is paused or the Digital Self is disabled', async () => {
    for (const self of [{ learningPaused: true }, { enabled: false }]) {
      const { svc, tx } = build({ self });
      expect(await svc.learnFromMessage('t1', 'm1')).toBe('paused');
      expect(tx.digitalSelf.update).not.toHaveBeenCalled();
    }
  });

  it('looks the message up by tenant, so a job cannot read another tenant\'s message', async () => {
    const { svc, prisma } = build();
    await svc.learnFromMessage('t1', 'm1');
    expect(prisma.message.findFirst.mock.calls[0][0].where).toEqual({ id: 'm1', tenantId: 't1' });
  });

  it('records a failure without message content', async () => {
    const { svc, prisma } = build();
    await svc.recordFailure('t1', 'm1', new TypeError('secret text here'));
    expect(prisma.digitalSelf.updateMany).toHaveBeenCalledWith({ where: { tenantId: 't1', userId: 'ama' }, data: { lastError: 'learning failed: TypeError' } });
  });
});

describe('DigitalSelfLearningTrigger', () => {
  it('queues nothing when the tenant flag is off', async () => {
    const queue = { add: jest.fn() };
    await new DigitalSelfLearningTrigger({ isEnabledCached: jest.fn().mockResolvedValue(false) } as never, queue as never).enqueue('t1', 'm1');
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('queues one deduplicated job with retries when enabled, and never throws', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    await new DigitalSelfLearningTrigger({ isEnabledCached: jest.fn().mockResolvedValue(true) } as never, queue as never).enqueue('t1', 'm1');
    expect(queue.add).toHaveBeenCalledWith('learn', { tenantId: 't1', messageId: 'm1' }, expect.objectContaining({ jobId: learnJobId('m1'), attempts: 3 }));
    const broken = { add: jest.fn().mockRejectedValue(new Error('redis down')) };
    await expect(new DigitalSelfLearningTrigger({ isEnabledCached: jest.fn().mockResolvedValue(true) } as never, broken as never).enqueue('t1', 'm1')).resolves.toBeUndefined();
  });
});

describe('DigitalSelfLearningProcessor', () => {
  const job = (data: unknown, attemptsMade = 0, attempts = 3) => ({ data, attemptsMade, opts: { attempts } }) as never;
  it('drops a malformed job and skips when the flag is off', async () => {
    const learning = { learnFromMessage: jest.fn(), recordFailure: jest.fn() };
    const p = new DigitalSelfLearningProcessor(learning as never, { isEnabledCached: jest.fn().mockResolvedValue(false) } as never);
    await p.process(job({}));
    await p.process(job({ tenantId: 't1', messageId: 'm1' }));
    expect(learning.learnFromMessage).not.toHaveBeenCalled();
  });
  it('retries a transient failure and records the failure only on the last attempt', async () => {
    const learning = { learnFromMessage: jest.fn().mockRejectedValue(new Error('db')), recordFailure: jest.fn() };
    const p = new DigitalSelfLearningProcessor(learning as never, { isEnabledCached: jest.fn().mockResolvedValue(true) } as never);
    await expect(p.process(job({ tenantId: 't1', messageId: 'm1' }, 0))).rejects.toThrow('db');
    expect(learning.recordFailure).not.toHaveBeenCalled();
    await expect(p.process(job({ tenantId: 't1', messageId: 'm1' }, 2))).rejects.toThrow('db');
    expect(learning.recordFailure).toHaveBeenCalledTimes(1);
  });
});
