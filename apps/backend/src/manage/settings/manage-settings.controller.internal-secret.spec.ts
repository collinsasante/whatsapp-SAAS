import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ManageSettingsController } from './manage-settings.controller';

/**
 * /manage/settings/ai/trial-expired and /manage/settings/subscription-downgraded are called by the worker but are reachable from the
 * internet. They must refuse every caller that does not present the configured secret, and must refuse EVERY caller when no secret
 * is configured. A refused call must not notify anyone or change any state.
 */
function build(configured: string | undefined) {
  const service = { notifyAiTrialExpired: jest.fn().mockResolvedValue(undefined), notifySubscriptionDowngraded: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn((key: string, fallback?: string) => (key === 'INTERNAL_SECRET' ? (configured ?? fallback) : undefined)) };
  const controller = new ManageSettingsController(service as never, config as never);
  return { controller, service };
}

const TENANT = '3f1c2b4a-5d6e-4f70-8a91-b2c3d4e5f607';

const ROUTES = [
  ['POST /ai/trial-expired', (c: ManageSettingsController, secret?: string, body?: { tenantId?: unknown }) => c.trialExpiredInternal(secret as string, body ?? { tenantId: TENANT }), 'notifyAiTrialExpired'],
  ['POST /subscription-downgraded', (c: ManageSettingsController, secret?: string, body?: { tenantId?: unknown }) => c.subscriptionDowngradedInternal(secret as string, body ?? { tenantId: TENANT }), 'notifySubscriptionDowngraded'],
] as const;

describe.each(ROUTES)('%s', (_route, call, effect) => {
  describe('with a configured secret', () => {
    it('accepts the correct secret, once, for the named workspace', async () => {
      const { controller, service } = build('correct-horse-battery');
      await expect(call(controller, 'correct-horse-battery')).resolves.toEqual({ ok: true });
      expect(service[effect]).toHaveBeenCalledTimes(1);
      expect(service[effect]).toHaveBeenCalledWith(TENANT);
    });

    it.each([
      ['a wrong secret', 'wrong'],
      ['a near miss', 'correct-horse-batterY'],
      ['a prefix', 'correct-horse'],
      ['an empty secret', ''],
      ['no secret header', undefined],
    ])('refuses %s and notifies nobody', async (_label, supplied) => {
      const { controller, service } = build('correct-horse-battery');
      await expect(call(controller, supplied)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(service[effect]).not.toHaveBeenCalled();
    });
  });

  describe('request body validation (after the secret check)', () => {
    it.each([['missing body', undefined], ['no tenantId', {}], ['empty tenantId', { tenantId: '' }], ['non-uuid tenantId', { tenantId: 'not-a-uuid' }], ['numeric tenantId', { tenantId: 5 }], ['object tenantId', { tenantId: { $ne: null } }]])(
      'answers 400, not 500, for %s, and notifies nobody',
      async (_label, body) => {
        const { controller, service } = build('correct-horse-battery');
        await expect(call(controller, 'correct-horse-battery', (body ?? {}) as { tenantId?: unknown })).rejects.toBeInstanceOf(BadRequestException);
        expect(service[effect]).not.toHaveBeenCalled();
      },
    );

    it('answers 401 (not 400) to an unauthenticated caller with a bad body, so the expected body is not disclosed', async () => {
      const { controller } = build('correct-horse-battery');
      await expect(call(controller, 'wrong', {})).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('with NO secret configured (the dangerous case: it used to let everyone in)', () => {
    it.each([
      ['the configured secret is unset', undefined],
      ['the configured secret is an empty string', ''],
    ])('refuses every caller when %s', async (_label, configured) => {
      for (const supplied of [undefined, '', 'anything', 'undefined', 'null']) {
        const { controller, service } = build(configured);
        await expect(call(controller, supplied)).rejects.toBeInstanceOf(UnauthorizedException);
        expect(service[effect]).not.toHaveBeenCalled();
      }
    });
  });
});
