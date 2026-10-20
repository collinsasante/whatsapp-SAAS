import { AiResponderService } from './ai-responder.service';

function build(settings: Record<string, unknown> | null, credits = 10) {
  const prisma = {
    tenantSettings: { findUnique: jest.fn().mockResolvedValue(settings) },
    tenant: { findUnique: jest.fn().mockResolvedValue({ aiCredits: credits }) },
  };
  const svc = Object.create(AiResponderService.prototype) as Record<string, unknown>;
  Object.assign(svc, { prisma });
  return svc as unknown as AiResponderService;
}
const ok = { aiEnabled: true, aiTrialApprovedAt: new Date(), aiAlwaysOn: true, offHoursEnabled: false, offHoursSchedule: {}, timezone: 'UTC' };

describe('AiResponderService.evaluateAvailability', () => {
  it('available when enabled, approved, funded and always on', async () => {
    expect(await build(ok).evaluateAvailability('t1')).toEqual({ available: true, reason: null });
  });
  it.each([
    ['AI disabled', null, 10, 'AI_DISABLED'],
    ['AI disabled flag', { ...ok, aiEnabled: false }, 10, 'AI_DISABLED'],
    ['trial not approved', { ...ok, aiTrialApprovedAt: null }, 10, 'TRIAL_NOT_APPROVED'],
    ['no credits', ok, 0, 'NO_CREDITS'],
    ['not always on and no off-hours schedule', { ...ok, aiAlwaysOn: false }, 10, 'OUTSIDE_SCHEDULE'],
  ])('%s -> %s', async (_label, settings, credits, reason) => {
    expect(await build(settings as never, credits as number).evaluateAvailability('t1')).toEqual({ available: false, reason });
  });
  it('shouldRespond stays exactly the boolean of evaluateAvailability', async () => {
    expect(await build(ok).shouldRespond('t1')).toBe(true);
    expect(await build({ ...ok, aiAlwaysOn: false }).shouldRespond('t1')).toBe(false);
  });
});
