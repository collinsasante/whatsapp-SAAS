import { buildTenantWhere, deriveTenantStatus, needsFullScan } from './tenant-directory.util';

const now = new Date('2026-10-15T12:00:00.000Z');

describe('deriveTenantStatus', () => {
  it('lets the account switch win over the subscription', () => {
    expect(deriveTenantStatus(false, 'ACTIVE')).toBe('suspended');
  });
  it('maps subscription states to what an admin would call them', () => {
    expect(deriveTenantStatus(true, null)).toBe('no_subscription');
    expect(deriveTenantStatus(true, 'CANCELED')).toBe('churned');
    expect(deriveTenantStatus(true, 'EXPIRED')).toBe('churned');
    expect(deriveTenantStatus(true, 'PAST_DUE')).toBe('past_due');
    expect(deriveTenantStatus(true, 'TRIAL')).toBe('trial');
    expect(deriveTenantStatus(true, 'ACTIVE')).toBe('active');
    expect(deriveTenantStatus(true, 'SUSPENDED')).toBe('suspended');
  });
});

describe('needsFullScan', () => {
  it('is only true for filters and sorts that depend on per-tenant computed numbers', () => {
    expect(needsFullScan({})).toBe(false);
    expect(needsFullScan({ sort: 'name' })).toBe(false);
    expect(needsFullScan({ sort: 'createdAt', filter: 'past_due' })).toBe(false);
    expect(needsFullScan({ filter: 'churn_risk' })).toBe(true);
    expect(needsFullScan({ filter: 'high_value' })).toBe(true);
    expect(needsFullScan({ sort: 'mrr' })).toBe(true);
    expect(needsFullScan({ sort: 'healthScore' })).toBe(true);
  });
});

describe('buildTenantWhere', () => {
  it('is an empty filter when nothing is asked for', () => {
    expect(buildTenantWhere({}, now)).toEqual({});
  });

  it('searches name, id, billing email and member email, case-insensitively', () => {
    const where = buildTenantWhere({ search: '  Acme ' }, now) as { AND: Array<{ OR: unknown[] }> };
    expect(where.AND[0].OR).toHaveLength(4);
    expect(JSON.stringify(where)).toContain('"contains":"Acme"');
    expect(JSON.stringify(where)).not.toContain('  Acme');
  });

  it('turns each status into a database condition, including the suspended subscription case', () => {
    const asJson = (status: never) => JSON.stringify(buildTenantWhere({ status }, now));
    expect(asJson('past_due' as never)).toContain('"status":"PAST_DUE"');
    expect(asJson('churned' as never)).toContain('CANCELED');
    expect(asJson('no_subscription' as never)).toContain('"subscription":{"is":null}');
    const suspended = asJson('suspended' as never);
    expect(suspended).toContain('"isActive":false');
    expect(suspended).toContain('"status":"SUSPENDED"');
  });

  it('includes the whole of the end date in a created-between filter', () => {
    const where = buildTenantWhere({ createdFrom: '2026-10-01', createdTo: '2026-10-10' }, now);
    const text = JSON.stringify(where);
    expect(text).toContain('2026-10-01T00:00:00.000Z');
    expect(text).toContain('2026-10-11T00:00:00.000Z');
  });

  it('keeps the trial-ending window to the next seven days from now', () => {
    const text = JSON.stringify(buildTenantWhere({ filter: 'trial_ending_7d' }, now));
    expect(text).toContain('"status":"TRIAL"');
    expect(text).toContain('2026-10-15T12:00:00.000Z');
    expect(text).toContain('2026-10-22T12:00:00.000Z');
  });

  it('starts "signed up this month" at the first of the month in UTC', () => {
    expect(JSON.stringify(buildTenantWhere({ filter: 'signed_up_this_month' }, now))).toContain('2026-10-01T00:00:00.000Z');
  });

  it('combines several filters with AND, not OR', () => {
    const where = buildTenantWhere({ plan: 'pro', active: 'true', status: 'trial' as never }, now) as { AND: unknown[] };
    expect(where.AND).toHaveLength(3);
  });
});
