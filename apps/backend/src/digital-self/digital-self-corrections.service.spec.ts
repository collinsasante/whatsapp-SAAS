import { FailureCategory, TrainingExampleStatus } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { AiLearningService } from '../ai-learning/ai-learning.service';
import { correctionKey, DigitalSelfCorrectionsService, isStyleCorrection, STYLE_CATEGORIES } from './digital-self-corrections.service';

const example = (over: Record<string, unknown> = {}) => ({
  id: 'ex1', tenantId: 't1', sourceConversationId: 'c1', status: TrainingExampleStatus.APPROVED, digitalSelfId: null, customerInput: 'how much?',
  expectedResponse: 'Sure! It is GH₵50 😊 Which colour would you like?', expectedAction: null, failureCategories: [FailureCategory.TOO_VERBOSE], ...over,
});

describe('isStyleCorrection', () => {
  const ok = (failureCategories: FailureCategory[], expectedResponse: string | null = 'A shorter reply') => isStyleCorrection({ failureCategories, expectedResponse });
  it('accepts only the style categories', () => {
    for (const c of STYLE_CATEGORIES) expect(ok([c])).toBe(true);
    expect(ok([FailureCategory.TOO_SHORT, FailureCategory.ROBOTIC_RESPONSE])).toBe(true);
  });
  it('rejects every factual or behavioural category, on its own or mixed with a style one', () => {
    const style = new Set<FailureCategory>(STYLE_CATEGORIES);
    for (const c of Object.values(FailureCategory).filter((c) => !style.has(c))) {
      expect(ok([c])).toBe(false);
      expect(ok([FailureCategory.TOO_VERBOSE, c])).toBe(false);
    }
  });
  it('rejects an example with no categories or no corrected reply to learn the style from', () => {
    expect(ok([])).toBe(false);
    expect(ok([FailureCategory.TOO_VERBOSE], null)).toBe(false);
    expect(ok([FailureCategory.TOO_VERBOSE], '   ')).toBe(false);
  });
});

function build(opts: { example?: Record<string, unknown> | null; conversation?: Record<string, unknown> | null; self?: Record<string, unknown> | null; existing?: Record<string, unknown> | null; flag?: boolean; excludedUnderLock?: boolean } = {}) {
  const tx = {
    $queryRaw: jest.fn().mockImplementation(async (q: { strings?: string[] }) => (String(q?.strings?.join('') ?? '').includes('conversations') ? [{ excluded: !!opts.excludedUnderLock }] : [])),
    digitalSelfLearningEvent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}), deleteMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null) },
    digitalSelf: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'dsAma', enabled: true, learningPaused: false, evidenceCount: 20, lastLearnedAt: new Date(), profile: {} }), findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'dsAma', enabled: true, learningPaused: false, profile: {} }), update: jest.fn().mockResolvedValue({}) },
    aiTrainingExample: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    aiTrainingExample: { findFirst: jest.fn().mockResolvedValue(opts.example === undefined ? example() : opts.example), updateMany: tx.aiTrainingExample.updateMany },
    conversation: { findFirst: jest.fn().mockResolvedValue(opts.conversation === undefined ? { digitalSelfId: 'dsAma', digitalSelfLearningExcluded: false } : opts.conversation) },
    digitalSelf: { findFirst: jest.fn().mockResolvedValue(opts.self === undefined ? { id: 'dsAma' } : opts.self) },
    digitalSelfLearningEvent: { findFirst: jest.fn().mockResolvedValue(opts.existing ?? null) },
    aiLearningAuditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const flags = { isEnabledCached: jest.fn().mockResolvedValue(opts.flag ?? true) };
  return { svc: new DigitalSelfCorrectionsService(prisma as never, flags as never), prisma, tx };
}

describe('DigitalSelfCorrectionsService.sync', () => {
  it('applies an approved style correction to the Digital Self assigned to its conversation, and to no other', async () => {
    const { svc, tx, prisma } = build();
    expect(await svc.sync('t1', 'ex1', 'admin')).toBe('applied');
    expect(tx.digitalSelfLearningEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 't1', digitalSelfId: 'dsAma', messageId: correctionKey('ex1'), source: 'CORRECTION', weight: 3, conversationId: 'c1' }) });
    expect(tx.digitalSelf.update.mock.calls.map((c) => c[0].where.id)).toEqual(['dsAma']);
    expect(tx.aiTrainingExample.updateMany).toHaveBeenCalledWith({ where: { id: 'ex1', tenantId: 't1' }, data: { digitalSelfId: 'dsAma' } });
    expect(prisma.aiLearningAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 't1', actorId: 'admin', action: 'digital_self.style_correction_applied', targetId: 'ex1' }) });
    // It does not count as one of the agent's own replies.
    expect(tx.digitalSelf.update.mock.calls[0][0].data).not.toHaveProperty('evidenceCount');
    expect(JSON.stringify(tx.digitalSelfLearningEvent.create.mock.calls[0][0].data.features)).not.toMatch(/GH₵|colour/);
  });

  it.each([
    ['wrong price', [FailureCategory.WRONG_PRICE]],
    ['wrong product', [FailureCategory.WRONG_PRODUCT]],
    ['a false action claim', [FailureCategory.FALSE_ACTION_CLAIM]],
    ['a lost-context failure', [FailureCategory.LOST_CONTEXT]],
    ['a customer correction', [FailureCategory.CUSTOMER_CORRECTION]],
    ['uncategorised', [FailureCategory.OTHER]],
    ['a factual category mixed with a style one', [FailureCategory.WRONG_PRICE, FailureCategory.TOO_VERBOSE]],
  ])('a factual correction (%s) can never modify a personality profile', async (_label, failureCategories) => {
    const { svc, tx, prisma } = build({ example: example({ failureCategories }) });
    expect(await svc.sync('t1', 'ex1', 'admin')).toBe('not_a_style_correction');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.digitalSelf.update).not.toHaveBeenCalled();
    expect(tx.digitalSelfLearningEvent.create).not.toHaveBeenCalled();
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled(); // not even looked up
  });

  it.each([TrainingExampleStatus.DRAFT, TrainingExampleStatus.REVIEW, TrainingExampleStatus.REJECTED, TrainingExampleStatus.ARCHIVED])('a %s example changes nothing', async (status) => {
    const { svc, tx } = build({ example: example({ status }) });
    expect(await svc.sync('t1', 'ex1', 'admin')).toBe('not_a_style_correction');
    expect(tx.digitalSelf.update).not.toHaveBeenCalled();
  });

  it('does nothing when no Digital Self is assigned, the agent is deactivated, or the conversation is excluded', async () => {
    for (const opts of [{ conversation: { digitalSelfId: null, digitalSelfLearningExcluded: false } }, { self: null }, { conversation: { digitalSelfId: 'dsAma', digitalSelfLearningExcluded: true } }]) {
      const { svc, tx } = build(opts);
      expect(['no_digital_self', 'excluded']).toContain(await svc.sync('t1', 'ex1', 'admin'));
      expect(tx.digitalSelfLearningEvent.create).not.toHaveBeenCalled();
    }
  });

  it('re-checks the exclusion under lock', async () => {
    const { svc, tx } = build({ excludedUnderLock: true });
    expect(await svc.sync('t1', 'ex1', 'admin')).toBe('excluded');
    expect(tx.digitalSelfLearningEvent.create).not.toHaveBeenCalled();
  });

  it('is idempotent: applying the same approved correction again changes nothing', async () => {
    const { svc, tx } = build({ example: example({ digitalSelfId: 'dsAma' }), existing: { id: 'e1', digitalSelfId: 'dsAma' } });
    expect(await svc.sync('t1', 'ex1', 'admin')).toBe('unchanged');
    expect(tx.digitalSelf.update).not.toHaveBeenCalled();
  });

  it('removes the contribution, rebuilds the profile and returns the example to ordinary guidance when approval is withdrawn', async () => {
    const { svc, tx, prisma } = build({ example: example({ status: TrainingExampleStatus.REJECTED, digitalSelfId: 'dsAma' }), existing: { id: 'e1', digitalSelfId: 'dsAma' } });
    expect(await svc.sync('t1', 'ex1', 'admin')).toBe('removed');
    expect(tx.digitalSelfLearningEvent.deleteMany).toHaveBeenCalledWith({ where: { id: 'e1', tenantId: 't1' } });
    expect(tx.digitalSelf.update).toHaveBeenCalled(); // rebuild
    expect(prisma.aiTrainingExample.updateMany).toHaveBeenCalledWith({ where: { id: 'ex1', tenantId: 't1' }, data: { digitalSelfId: null } });
    expect(prisma.aiLearningAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'digital_self.style_correction_removed' }) });
  });

  it('is scoped by tenant, and does nothing when the feature flag is off', async () => {
    const other = build({ example: null });
    expect(await other.svc.sync('t2', 'ex1', 'admin')).toBe('missing');
    expect(other.prisma.aiTrainingExample.findFirst.mock.calls[0][0].where).toEqual({ id: 'ex1', tenantId: 't2' });
    const off = build({ flag: false });
    expect(await off.svc.sync('t1', 'ex1', 'admin')).toBe('disabled');
    expect(off.prisma.aiTrainingExample.findFirst).not.toHaveBeenCalled();
  });
});

describe('the approval workflow is preserved', () => {
  function workflow(sync: jest.Mock) {
    const prisma = {
      aiTrainingExample: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ex1', tenantId: 't1', status: 'REVIEW', customerInput: 'hi', expectedResponse: 'hello there', expectedAction: null }),
        update: jest.fn().mockResolvedValue({ id: 'ex1', status: 'APPROVED' }),
      },
      aiLearningAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    return { service: new AiLearningService(prisma as never, { sync } as never), prisma };
  }
  it('asks for a sync after the status change, with the tenant and the approver', async () => {
    const sync = jest.fn().mockResolvedValue('applied');
    const { service } = workflow(sync);
    await service.setTrainingExampleStatus('t1', 'ex1', TrainingExampleStatus.APPROVED, 'admin');
    expect(sync).toHaveBeenCalledWith('t1', 'ex1', 'admin');
  });
  it('still approves when the Digital Self sync fails', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, prisma } = workflow(jest.fn().mockRejectedValue(new Error('boom')));
    await expect(service.setTrainingExampleStatus('t1', 'ex1', TrainingExampleStatus.APPROVED, 'admin')).resolves.toMatchObject({ status: 'APPROVED' });
    expect(prisma.aiTrainingExample.update).toHaveBeenCalled();
  });
  it('still rejects an approval with nothing to teach, before any sync', async () => {
    const sync = jest.fn();
    const { service, prisma } = workflow(sync);
    prisma.aiTrainingExample.findFirst.mockResolvedValue({ id: 'ex1', tenantId: 't1', status: 'REVIEW', customerInput: '', expectedResponse: null, expectedAction: null });
    await expect(service.setTrainingExampleStatus('t1', 'ex1', TrainingExampleStatus.APPROVED, 'admin')).rejects.toThrow();
    expect(sync).not.toHaveBeenCalled();
  });
});
