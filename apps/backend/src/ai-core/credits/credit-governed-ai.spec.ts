import { AiMeteredProviderService } from '../completion/ai-metered-provider.service';
import { AiProvider, AiProviderError, ChatCompletionResult } from '../providers/ai-provider.interface';
import { AiCreditsService, InsufficientAiCreditsError } from './ai-credits.service';
import { AiCreditTransactionType, Prisma } from '@prisma/client';
import { ManageSettingsService } from '../../manage/settings/manage-settings.service';
import { AiResponderService } from '../../ai/ai-responder.service';

/**
 * VerzAI is governed by the AI credit balance and nothing else. These tests run the REAL metering (AiMeteredProviderService) on the
 * REAL credit ledger (AiCreditsService) over an in-memory store that has NO subscription or plan tables at all, so a passing test
 * proves chargeable AI usage, deduction, refusal at an empty balance and top-ups work with no monthly subscription anywhere.
 */
function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' });
}

function buildPrismaMock(startingCredits = 100) {
  const overrides: Partial<Record<string, unknown>> = {};
  const tenant = { id: 't1', aiCredits: startingCredits };
  const reservations = new Map<string, Record<string, unknown>>();
  let reservationCounter = 0;
  const base = {
    tenant: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve({ ...tenant })),
      updateMany: jest.fn().mockImplementation(({ data }: { data: { aiCredits: { decrement: number } } }) => {
        tenant.aiCredits -= data.aiCredits.decrement;
        return Promise.resolve({ count: 1 });
      }),
      update: jest.fn().mockImplementation(({ data }: { data: { aiCredits: { increment?: number; decrement?: number } } }) => {
        tenant.aiCredits += data.aiCredits.increment ?? 0;
        tenant.aiCredits -= data.aiCredits.decrement ?? 0;
        return Promise.resolve({ ...tenant });
      }),
    },
    aiCreditTransaction: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'txn-1', ...data })),
    },
    aiCreditReservation: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const id = `reservation-${++reservationCounter}`;
        const reservation = { id, ...data, status: 'RESERVED' };
        reservations.set(id, reservation);
        return Promise.resolve(reservation);
      }),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(reservations.get(where.id) ?? null)),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockImplementation(({ where }: { where: { tenantId: string; status: string } }) => {
        const held = [...reservations.values()]
          .filter((reservation) => reservation.tenantId === where.tenantId && reservation.status === where.status)
          .reduce((total, reservation) => total + Number(reservation.reservedCredits), 0);
        return Promise.resolve({ _sum: { reservedCredits: held || null } });
      }),
      update: jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const reservation = { ...reservations.get(where.id), ...data };
        reservations.set(where.id, reservation);
        return Promise.resolve(reservation);
      }),
      updateMany: jest.fn().mockImplementation(({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        const reservation = reservations.get(where.id);
        if (!reservation || reservation.status !== where.status) return Promise.resolve({ count: 0 });
        reservations.set(where.id, { ...reservation, ...data });
        return Promise.resolve({ count: 1 });
      }),
    },
    // no settings row = no daily spend cap (the cap itself is covered against a real database in ai-credits.spend-cap.db.spec.ts)
    tenantSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 't1' }]),
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(base)),
    ...overrides,
  };
  return base;
}


function build(startingCredits: number) {
  const prisma = buildPrismaMock(startingCredits);
  // The whole store has no subscription, plan or invoice model: nothing here can consult one.
  expect((prisma as Record<string, unknown>)['subscription']).toBeUndefined();
  const pricing = {
    getReservationQuote: jest.fn().mockResolvedValue({ reservedCredits: 50, maxCreditsPerAttempt: 25, creditsPerUsd: 2000, inputPerMTokUsd: 0.14, outputPerMTokUsd: 0.28 }),
    calculateCreditsForUsage: jest.fn().mockReturnValue(10),
  };
  const credits = new AiCreditsService(prisma as never, pricing as never);
  const metered = new AiMeteredProviderService(credits);
  const result: ChatCompletionResult = {
    content: 'ok', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 20 }, provider: 'deepseek', model: 'deepseek-v4-flash', latencyMs: 1, attemptsUsed: 1,
  };
  const provider: AiProvider & { complete: jest.Mock } = { key: 'deepseek', maxAttempts: 1, complete: jest.fn().mockResolvedValue(result) } as never;
  return { prisma, credits, metered, provider };
}
const request = { modelKey: 'deepseek-v4-flash', messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 400 };

describe('chargeable AI usage is governed by the credit balance', () => {
  it('a workspace with enough credits and no subscription gets its AI call, and is charged for what was used', async () => {
    const { metered, provider, credits, prisma } = build(100);
    const out = await metered.complete(provider, 't1', 'RESPONDER', request);
    expect(out.result.content).toBe('ok');
    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(await credits.getBalance('t1')).toBe(90); // 100 - the 10 credits the usage cost; the 50-credit hold is released
    expect(prisma.aiCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: AiCreditTransactionType.AI_USAGE, credits: -10 }),
    }));
  });

  it('a workspace without enough credits cannot make a chargeable call: the provider is never reached and nothing is charged', async () => {
    const { metered, provider, credits } = build(20); // below the 50-credit reservation
    await expect(metered.complete(provider, 't1', 'RESPONDER', request)).rejects.toBeInstanceOf(InsufficientAiCreditsError);
    expect(provider.complete).not.toHaveBeenCalled();
    expect(await credits.getBalance('t1')).toBe(20);
  });

  it('an empty balance is refused the same way', async () => {
    const { metered, provider } = build(0);
    await expect(metered.complete(provider, 't1', 'RESPONDER', request)).rejects.toBeInstanceOf(InsufficientAiCreditsError);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('credits cannot be bypassed by a failed attempt: a definitive provider rejection releases the hold and charges nothing', async () => {
    const { metered, provider, credits } = build(100);
    provider.complete.mockRejectedValue(new AiProviderError('auth', 'rejected', false));
    await expect(metered.complete(provider, 't1', 'RESPONDER', request)).rejects.toBeInstanceOf(AiProviderError);
    expect(await credits.getBalance('t1')).toBe(100);
  });

  it('simulated test chats stay unmetered, so they neither need nor use credits', async () => {
    const { metered, provider, credits } = build(0);
    await expect(metered.complete(provider, 't1', 'TEST', request)).resolves.toBeDefined();
    expect(await credits.getBalance('t1')).toBe(0);
  });

  it('a top-up restores the ability to use AI, and a repeated payment confirmation grants the credits only once', async () => {
    const { metered, provider, credits, prisma } = build(0);
    await expect(metered.complete(provider, 't1', 'RESPONDER', request)).rejects.toBeInstanceOf(InsufficientAiCreditsError);

    const first = await credits.grant('t1', AiCreditTransactionType.PURCHASE, 1000, 'Credit pack purchase', { creditPurchaseId: 'purchase-1' });
    expect(first.settled).toBe(true);
    expect(await credits.getBalance('t1')).toBe(1000);
    // The payment webhook arrives a second time: the ledger already holds that purchase, so nothing more is granted.
    prisma.aiCreditTransaction.findUnique.mockResolvedValueOnce({ id: 'txn-1', creditPurchaseId: 'purchase-1', credits: 1000 });
    await credits.grant('t1', AiCreditTransactionType.PURCHASE, 1000, 'Credit pack purchase', { creditPurchaseId: 'purchase-1' });
    expect(await credits.getBalance('t1')).toBe(1000);

    await expect(metered.complete(provider, 't1', 'RESPONDER', request)).resolves.toBeDefined();
    expect(await credits.getBalance('t1')).toBe(990);
  });

  it('an existing balance is untouched by anything except purchases, bonuses and metered usage', async () => {
    const { credits } = build(4321);
    expect(await credits.getBalance('t1')).toBe(4321);
    expect(await credits.hasSufficientBalance('t1')).toBe(true);
  });
});

describe('activate at zero credits, stay paused while empty, resume by itself after a top-up', () => {
  function workspaceAtZero() {
    const parts = build(0);
    const settings: Record<string, unknown> = { aiEnabled: false, aiTrialApprovedAt: null, aiAlwaysOn: true, offHoursEnabled: false, offHoursSchedule: null, timezone: 'UTC' };
    Object.assign(parts.prisma, {
      tenantSettings: {
        findUnique: jest.fn(async () => ({ ...settings })),
        upsert: jest.fn(async ({ update }: { update: Record<string, unknown> }) => Object.assign(settings, update)),
      },
    });
    const manage = new ManageSettingsService(parts.prisma as never, {} as never, {} as never, { getJob: jest.fn(), add: jest.fn() } as never);
    const responder = new AiResponderService(parts.prisma as never, {} as never, {} as never);
    return { ...parts, settings, manage, responder };
  }

  it('approval succeeds at zero credits and leaves VerzAI switched on', async () => {
    const { manage, settings, credits } = workspaceAtZero();
    await expect(manage.approveAi('t1')).resolves.toBeDefined();
    expect(settings['aiEnabled']).toBe(true);
    expect(settings['aiTrialApprovedAt']).toBeInstanceOf(Date);
    expect(await credits.getBalance('t1')).toBe(0); // activating gave no credits
  });

  it('while the balance is empty the AI stays silent and no chargeable call can be made', async () => {
    const { manage, responder, metered, provider, credits } = workspaceAtZero();
    await manage.approveAi('t1');
    expect(await responder.evaluateAvailability('t1')).toEqual({ available: false, reason: 'NO_CREDITS' });
    expect(await responder.shouldRespond('t1')).toBe(false);
    await expect(metered.complete(provider, 't1', 'RESPONDER', request)).rejects.toBeInstanceOf(InsufficientAiCreditsError);
    expect(provider.complete).not.toHaveBeenCalled(); // not one free reply
    expect(await credits.getBalance('t1')).toBe(0);
  });

  it('a partial balance below the reservation is still refused, and nothing is deducted', async () => {
    const { manage, metered, provider, credits, prisma } = workspaceAtZero();
    await manage.approveAi('t1');
    await credits.grant('t1', AiCreditTransactionType.BONUS, 30, 'Small bonus');
    await expect(metered.complete(provider, 't1', 'RESPONDER', request)).rejects.toBeInstanceOf(InsufficientAiCreditsError);
    expect(provider.complete).not.toHaveBeenCalled();
    expect(await credits.getBalance('t1')).toBe(30);
    expect(prisma.aiCreditTransaction.create).toHaveBeenCalledTimes(1); // only the bonus
  });

  it('after a successful top-up the AI answers again with no further activation, and is metered', async () => {
    const { manage, responder, metered, provider, credits, settings, prisma } = workspaceAtZero();
    await manage.approveAi('t1');
    expect((await responder.evaluateAvailability('t1')).available).toBe(false);

    await credits.grant('t1', AiCreditTransactionType.PURCHASE, 1000, 'Credit pack purchase', { creditPurchaseId: 'purchase-1' });

    expect(settings['aiEnabled']).toBe(true); // nothing switched it off while empty
    expect(await responder.evaluateAvailability('t1')).toEqual({ available: true, reason: null });
    await expect(metered.complete(provider, 't1', 'RESPONDER', request)).resolves.toBeDefined();
    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(await credits.getBalance('t1')).toBe(990);
    expect((prisma as unknown as { tenantSettings: { upsert: jest.Mock } }).tenantSettings.upsert).toHaveBeenCalledTimes(1); // approved once, never again
  });
});
