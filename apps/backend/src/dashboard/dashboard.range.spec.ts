import { BadRequestException } from '@nestjs/common';
import { parseDateRange } from './date-range.util';
import { DashboardService } from './dashboard.service';

const NOW = new Date('2026-10-15T12:00:00.000Z');

describe('parseDateRange', () => {
  it('a plain "to" date includes the whole last day (today\'s conversations were excluded before)', () => {
    const r = parseDateRange('2026-09-15', '2026-10-15', NOW);
    expect(r.to.toISOString()).toBe('2026-10-15T23:59:59.999Z');
    expect(r.from.toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });
  it('a full timestamp is used exactly as given', () => {
    expect(parseDateRange('2026-10-01T00:00:00Z', '2026-10-15T08:30:00Z', NOW).to.toISOString()).toBe('2026-10-15T08:30:00.000Z');
  });
  it('defaults to the 30 days up to now', () => {
    const r = parseDateRange(undefined, undefined, NOW);
    expect(r.to).toEqual(NOW);
    expect(r.from.toISOString()).toBe('2026-09-15T12:00:00.000Z');
  });
  it.each([['garbage', undefined], [undefined, 'not-a-date'], ['2026-13-45', '2026-10-15'], ['', 'abc']])('rejects invalid input (%j, %j) with a 400, not a 500', (from, to) => {
    expect(() => parseDateRange(from as string | undefined, to as string | undefined, NOW)).toThrow(BadRequestException);
  });
  it('rejects an inverted range and an excessive one', () => {
    expect(() => parseDateRange('2026-10-15', '2026-10-01', NOW)).toThrow('on or before');
    expect(() => parseDateRange('2020-01-01', '2026-10-15', NOW)).toThrow('longer than');
  });
});

describe('DashboardService', () => {
  function build() {
    const prisma = { conversation: { count: jest.fn().mockResolvedValueOnce(7).mockResolvedValueOnce(3) } };
    const whatsapp = { getBusinessProfile: jest.fn() };
    const svc = Object.create(DashboardService.prototype) as Record<string, unknown>;
    Object.assign(svc, { prisma, whatsappService: whatsapp, businessProfileCache: new Map() });
    return { svc: svc as unknown as DashboardService, prisma, whatsapp };
  }

  it('conversation stats are scoped to the caller tenant for both counts', async () => {
    const { svc, prisma } = build();
    const out = await svc.getConversationStats('tenant-A', new Date('2026-09-15'), new Date('2026-10-15'));
    expect(out).toEqual({ opened: 7, closed: 3 });
    for (const call of prisma.conversation.count.mock.calls) expect(call[0].where.tenantId).toBe('tenant-A');
  });

  it('caches a successful business profile briefly, per tenant', async () => {
    const { svc, whatsapp } = build();
    whatsapp.getBusinessProfile.mockResolvedValue({ phone: {}, profile: {} });
    await svc.getBusinessProfile('t1');
    await svc.getBusinessProfile('t1');
    expect(whatsapp.getBusinessProfile).toHaveBeenCalledTimes(1);
    await svc.getBusinessProfile('t2');
    expect(whatsapp.getBusinessProfile).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure (null), so a transient error does not stick', async () => {
    const { svc, whatsapp } = build();
    whatsapp.getBusinessProfile.mockResolvedValueOnce(null).mockResolvedValueOnce({ phone: {}, profile: {} });
    expect(await svc.getBusinessProfile('t1')).toBeNull();
    expect(await svc.getBusinessProfile('t1')).toEqual({ phone: {}, profile: {} });
    expect(whatsapp.getBusinessProfile).toHaveBeenCalledTimes(2);
  });
});
