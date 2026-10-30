import { TenantsQueryDto } from './dto/platform-admin.dto';

/**
 * The status shown for a tenant in the directory. It combines the account switch (isActive) with the subscription,
 * because an admin asking "who is suspended" or "who is past due" is asking about the combination, not either column.
 */
export const TENANT_STATUSES = ['active', 'trial', 'past_due', 'suspended', 'churned', 'no_subscription'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export function deriveTenantStatus(isActive: boolean, subscriptionStatus: string | null): TenantStatus {
  if (!isActive) return 'suspended';
  if (!subscriptionStatus) return 'no_subscription';
  if (subscriptionStatus === 'CANCELED' || subscriptionStatus === 'EXPIRED') return 'churned';
  const lower = subscriptionStatus.toLowerCase();
  return (TENANT_STATUSES as readonly string[]).includes(lower) ? (lower as TenantStatus) : 'active';
}

/** Filters that depend on numbers computed per tenant (churn risk, top MRR) and so need every tenant scored first. */
export function needsFullScan(query: Pick<TenantsQueryDto, 'filter' | 'sort'>): boolean {
  return query.filter === 'churn_risk' || query.filter === 'high_value' || query.sort === 'mrr' || query.sort === 'healthScore';
}

type Where = Record<string, unknown>;

/**
 * Builds the database filter for the tenant directory, so a page is read with LIMIT/OFFSET instead of loading every
 * tenant. Only conditions the database can evaluate are here; churn risk and "high value" are applied afterwards.
 */
export function buildTenantWhere(query: TenantsQueryDto, now: Date): Where {
  const and: Where[] = [];

  const search = query.search?.trim();
  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { id: search },
        { billingEmail: { contains: search, mode: 'insensitive' } },
        { users: { some: { email: { contains: search, mode: 'insensitive' } } } },
      ],
    });
  }

  if (query.plan) and.push({ subscription: { is: { plan: { is: { slug: query.plan } } } } });

  if (query.status) {
    switch (query.status) {
      case 'suspended': and.push({ OR: [{ isActive: false }, { isActive: true, subscription: { is: { status: 'SUSPENDED' } } }] }); break;
      case 'no_subscription': and.push({ isActive: true, subscription: { is: null } }); break;
      case 'churned': and.push({ isActive: true, subscription: { is: { status: { in: ['CANCELED', 'EXPIRED'] } } } }); break;
      default: and.push({ isActive: true, subscription: { is: { status: query.status.toUpperCase() } } });
    }
  }

  if (query.active === 'true') and.push({ isActive: true });
  if (query.active === 'false') and.push({ isActive: false });

  if (query.createdFrom) and.push({ createdAt: { gte: new Date(`${query.createdFrom}T00:00:00.000Z`) } });
  if (query.createdTo) and.push({ createdAt: { lt: new Date(new Date(`${query.createdTo}T00:00:00.000Z`).getTime() + 86_400_000) } });

  switch (query.filter) {
    case 'trial_ending_7d':
      and.push({ isActive: true, subscription: { is: { status: 'TRIAL', trialEndsAt: { gte: now, lte: new Date(now.getTime() + 7 * 86_400_000) } } } });
      break;
    case 'signed_up_this_month':
      and.push({ createdAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } });
      break;
    case 'past_due':
      and.push({ isActive: true, subscription: { is: { status: 'PAST_DUE' } } });
      break;
    default: break;
  }

  return and.length ? { AND: and } : {};
}
