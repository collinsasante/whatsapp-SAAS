import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialsEncryptionService } from '../common/crypto/credentials-encryption.service';
import { AnalyticsIntelligenceService } from '../analytics/analytics-intelligence.service';
import { effectiveReplyDeadlineMinutes } from '../conversations/reply-deadline.util';
import { MetaPhoneStatusClient, type MetaPhoneNode } from './meta-phone-status.client';
import type {
  DashboardBusiness, DashboardMeta, DashboardRequests, DashboardWhatsAppStatus, WhatsAppNumberStatus,
} from './dashboard-command.types';

const REQUEST_SAMPLE_LIMIT = 5;
/** Meta is asked at most once a minute per workspace; a manual refresh may repeat a check after this many seconds. */
const STATUS_CACHE_MS = 60_000;
const STATUS_REFRESH_MIN_MS = 10_000;
const MAX_NUMBERS = 10;

const num = (value: unknown): number => (value == null ? 0 : Number(value));
const clean = (value: string | null | undefined): string | null => (value && value.trim() ? value.trim() : null);
const QUALITY = new Set(['GREEN', 'YELLOW', 'RED']);

/** Workspace-level cards for the owner dashboard: waiting requests, business details and WhatsApp health from Meta. */
@Injectable()
export class DashboardAccountService {
  private readonly logger = new Logger(DashboardAccountService.name);
  private readonly statusCache = new Map<string, { at: number; value: Omit<DashboardWhatsAppStatus, 'meta'> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsIntelligenceService,
    private readonly encryption: CredentialsEncryptionService,
    private readonly meta: MetaPhoneStatusClient,
  ) {}

  private async workspaceMeta(tenantId: string): Promise<DashboardMeta> {
    const [tenant, settings] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } }),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    return {
      workspaceName: tenant?.name ?? '', from: today, to: today, previousFrom: today, previousTo: today, days: 1,
      timezone: settings?.timezone ?? 'Africa/Accra', granularity: 'day', generatedAt: new Date().toISOString(),
    };
  }

  // ─── Requests waiting for a person ─────────────────────────────────────────

  async getRequests(tenantId: string): Promise<DashboardRequests> {
    const now = new Date();
    const [meta, settings, totals, samples] = await Promise.all([
      this.workspaceMeta(tenantId),
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { replyDeadlineMinutes: true } }),
      this.prisma.$queryRaw<Array<{ requesting: number; overdue: number; oldest: Date | null }>>`
        SELECT COUNT(*)::int AS requesting,
          COUNT(*) FILTER (WHERE c.sla_breached OR (c.sla_deadline IS NOT NULL AND c.sla_deadline <= ${now}))::int AS overdue,
          MIN(COALESCE(c.requested_at, c.created_at)) AS oldest
        FROM conversations c
        WHERE c.tenant_id = ${tenantId} AND c.status::text = 'REQUESTED' AND ${this.analytics.notTest('c')}
      `,
      this.prisma.$queryRaw<Array<{ id: string; name: string | null; since: Date; overdue: boolean }>>`
        SELECT c.id, k.name, COALESCE(c.requested_at, c.created_at) AS since,
          (c.sla_breached OR (c.sla_deadline IS NOT NULL AND c.sla_deadline <= ${now})) AS overdue
        FROM conversations c JOIN contacts k ON k.id = c.contact_id
        WHERE c.tenant_id = ${tenantId} AND c.status::text = 'REQUESTED' AND ${this.analytics.notTest('c')}
        ORDER BY since ASC LIMIT ${REQUEST_SAMPLE_LIMIT}
      `,
    ]);
    const row = totals[0];
    const seconds = (d: Date) => Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
    return {
      meta,
      requesting: num(row?.requesting),
      overdue: num(row?.overdue),
      oldestWaitingSeconds: row?.oldest ? seconds(row.oldest) : null,
      deadlineMinutes: effectiveReplyDeadlineMinutes(settings),
      samples: samples.map((s) => ({ conversationId: s.id, contactName: s.name, waitingSeconds: seconds(s.since), overdue: !!s.overdue })),
    };
  }

  // ─── Business information and account details ──────────────────────────────

  async getBusiness(tenantId: string): Promise<DashboardBusiness> {
    const [meta, tenant, members, channels] = await Promise.all([
      this.workspaceMeta(tenantId),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { settings: true, subscription: { include: { plan: true } } },
      }),
      this.prisma.user.count({ where: { tenantId, isActive: true, isAiAgent: false } }),
      this.prisma.channel.count({ where: { tenantId, isActive: true } }),
    ]);
    const s = tenant?.settings;
    const phone = clean(s?.businessPhone);
    const email = clean(s?.businessEmail);
    const address = clean(s?.businessAddress) ?? clean(tenant?.businessAddress);
    const website = clean(s?.businessWebsite) ?? clean(tenant?.businessWebsite);
    const description = clean(s?.businessDescription) ?? clean(tenant?.businessDescription);
    const missing = (Object.entries({ phone, email, address, website, description }) as Array<[DashboardBusiness['missing'][number], string | null]>)
      .filter(([, v]) => v == null).map(([k]) => k);
    const sub = tenant?.subscription;
    return {
      meta,
      business: {
        name: clean(s?.businessName) ?? tenant?.name ?? '',
        phone, email, address, website, description,
        category: clean(tenant?.businessCategory), logoUrl: clean(tenant?.logoUrl),
      },
      missing,
      account: {
        plan: sub?.plan?.name ?? tenant?.plan ?? 'Free',
        subscriptionStatus: sub?.status ?? null,
        billingCycle: sub?.cycle ?? null,
        trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
        currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        createdAt: (tenant?.createdAt ?? new Date()).toISOString(),
        timezone: s?.timezone ?? 'Africa/Accra',
        members, channels,
        aiCreditsBalance: tenant?.aiCredits ?? 0,
        billingEmail: clean(tenant?.billingEmail),
      },
    };
  }

  // ─── WhatsApp account status from Meta ─────────────────────────────────────

  async getWhatsAppStatus(tenantId: string, refresh = false): Promise<DashboardWhatsAppStatus> {
    const meta = await this.workspaceMeta(tenantId);
    const cached = this.statusCache.get(tenantId);
    const age = cached ? Date.now() - cached.at : Infinity;
    if (cached && age < (refresh ? STATUS_REFRESH_MIN_MS : STATUS_CACHE_MS)) return { meta, ...cached.value };

    const [numbers, sessions] = await Promise.all([
      this.prisma.whatsAppNumber.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        take: MAX_NUMBERS,
        select: {
          id: true, label: true, isDefault: true, phoneNumberId: true, accessToken: true,
          qualityRating: true, messagingLimitTier: true, qualitySyncedAt: true, lastError: true,
        },
      }),
      this.prisma.whatsAppWebSession.findMany({
        where: { tenantId },
        select: { id: true, phoneNumber: true, status: true, lastSeenAt: true, lastError: true },
        take: MAX_NUMBERS,
      }),
    ]);

    const results = await Promise.all(numbers.map((n) => this.checkNumber(tenantId, n)));
    const value = {
      checkedAt: new Date().toISOString(),
      connected: numbers.length > 0,
      numbers: results,
      qrSessions: sessions.map((s) => ({
        id: s.id, phoneNumber: s.phoneNumber, status: s.status, lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
        lastError: s.lastError ? 'The linked phone reported an error.' : null,
      })),
    };
    this.statusCache.set(tenantId, { at: Date.now(), value });
    return { meta, ...value };
  }

  private async checkNumber(tenantId: string, n: {
    id: string; label: string; isDefault: boolean; phoneNumberId: string; accessToken: string;
    qualityRating: string | null; messagingLimitTier: string | null; qualitySyncedAt: Date | null; lastError: string | null;
  }): Promise<WhatsAppNumberStatus> {
    const base = {
      id: n.id, label: n.label, isDefault: n.isDefault,
      lastKnown: { quality: n.qualityRating, messagingLimit: n.messagingLimitTier, syncedAt: n.qualitySyncedAt?.toISOString() ?? null },
      lastError: n.lastError ? 'The last send or sync through this number failed.' : null,
    };
    let token: string;
    try {
      token = this.encryption.decrypt(n.accessToken);
    } catch {
      this.logger.warn(`[tenant:${tenantId}] could not decrypt the access token of WhatsApp number ${n.id}`);
      return { ...base, live: null, error: { kind: 'TOKEN_INVALID', message: 'The saved access token could not be read. Reconnect this number in Channels.' } };
    }
    const result = await this.meta.fetch(n.phoneNumberId, token);
    if (!result.ok) return { ...base, live: null, error: { kind: result.kind, message: result.message } };
    return { ...base, live: this.toLive(result.data), error: null };
  }

  private toLive(d: MetaPhoneNode): NonNullable<WhatsAppNumberStatus['live']> {
    const quality = (d.quality_rating ?? '').toUpperCase();
    return {
      displayPhone: clean(d.display_phone_number), verifiedName: clean(d.verified_name),
      quality: QUALITY.has(quality) ? (quality as 'GREEN' | 'YELLOW' | 'RED') : 'UNKNOWN',
      messagingLimit: clean(d.messaging_limit_tier), numberStatus: clean(d.status),
      nameStatus: clean(d.name_status), verification: clean(d.code_verification_status),
    };
  }
}
