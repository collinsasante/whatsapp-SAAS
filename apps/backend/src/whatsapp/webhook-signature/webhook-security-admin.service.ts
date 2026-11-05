import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialsEncryptionService } from '../../common/crypto/credentials-encryption.service';
import { MetaSubscribedAppsClient } from './meta-subscribed-apps.client';
import { LEGACY_ENV_APP_ID, WhatsappWebhookSignatureService } from './whatsapp-webhook-signature.service';
import { META_APP_ID, UpsertMetaAppDto } from './webhook-security.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const GOOD = new Set(['valid', 'valid_no_waba']);

export interface AppView {
  appId: string;
  label: string;
  status: string;
  hasSecret: boolean;
  secretFingerprint: string | null;
  mappedWabas: number;
  updatedAt: Date;
}

export interface WabaCoverage {
  wabaId: string;
  tenant: string;
  mappedApps: string[];
  requests: number;
  valid: number;
  problems: Record<string, number>;
  verdict: 'ready' | 'not_ready' | 'no_traffic';
  reason: string;
}

/**
 * Registry administration and the evidence an operator needs before enforcing. Nothing here returns a secret, a token or a request body.
 */
@Injectable()
export class WebhookSecurityAdminService {
  private readonly logger = new Logger(WebhookSecurityAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialsEncryptionService,
    private readonly signatures: WhatsappWebhookSignatureService,
    private readonly metaClient: MetaSubscribedAppsClient,
  ) {}

  async listApps(): Promise<AppView[]> {
    const rows = await this.prisma.whatsappMetaApp.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { mappings: true } } } });
    return rows.map((r) => ({ appId: r.appId, label: r.label, status: r.status, hasSecret: !!r.secretEnc, secretFingerprint: r.secretFingerprint, mappedWabas: r._count.mappings, updatedAt: r.updatedAt }));
  }

  async upsertApp(appId: string, dto: UpsertMetaAppDto): Promise<AppView> {
    if (!META_APP_ID.test(appId)) throw new BadRequestException('appId must be the numeric Meta app id');
    const data: { label: string; status?: string; secretEnc?: string; secretFingerprint?: string } = { label: dto.label.trim() };
    if (dto.status) data.status = dto.status;
    if (dto.secret !== undefined) {
      // Refuse rather than fall back to plaintext: with no key configured the encryption service passes values through unchanged.
      if (!this.encryption.isActive) throw new ConflictException('CREDENTIALS_ENCRYPTION_KEY is not configured on this server, so an app secret cannot be stored. Configure the key first.');
      const encrypted = this.encryption.encrypt(dto.secret);
      if (!this.encryption.isEncrypted(encrypted)) throw new ConflictException('The app secret could not be encrypted; nothing was stored.');
      data.secretEnc = encrypted;
      data.secretFingerprint = crypto.createHash('sha256').update(dto.secret).digest('hex').slice(0, 8);
    }
    const row = await this.prisma.whatsappMetaApp.upsert({ where: { appId }, create: { appId, ...data }, update: data, include: { _count: { select: { mappings: true } } } });
    this.signatures.invalidate();
    return { appId: row.appId, label: row.label, status: row.status, hasSecret: !!row.secretEnc, secretFingerprint: row.secretFingerprint, mappedWabas: row._count.mappings, updatedAt: row.updatedAt };
  }

  async mapWaba(appId: string, tenantId: string, wabaId: string, source: 'manual' | 'discovered' = 'manual') {
    const app = await this.prisma.whatsappMetaApp.findUnique({ where: { appId }, select: { id: true } });
    if (!app) throw new NotFoundException('Meta app is not registered');
    // The tenant must really own the WABA: a mapping can never attach one tenant's WABA to another tenant.
    const number = await this.prisma.whatsAppNumber.findFirst({ where: { tenantId, wabaId }, select: { id: true } });
    if (!number) throw new NotFoundException('That tenant has no WhatsApp number on this WABA');
    const row = await this.prisma.whatsappWabaApp.upsert({
      where: { tenantId_wabaId_metaAppId: { tenantId, wabaId, metaAppId: app.id } },
      create: { tenantId, wabaId, metaAppId: app.id, source },
      update: {},
    });
    this.signatures.invalidate();
    return { id: row.id, appId, tenantId, wabaId, source: row.source };
  }

  async unmap(mappingId: string): Promise<void> {
    const found = await this.prisma.whatsappWabaApp.findUnique({ where: { id: mappingId }, select: { id: true } });
    if (!found) throw new NotFoundException('Mapping not found');
    await this.prisma.whatsappWabaApp.delete({ where: { id: mappingId } });
    this.signatures.invalidate();
  }

  /**
   * What the last N days of signature checks showed, per WABA, and whether it is safe to enforce. A WABA is "ready" when it has traffic, at least
   * `minValid` requests verified, and not one problem outcome. A WABA with no traffic cannot be judged and is reported separately.
   */
  async summary(days = 7, minValid = 10) {
    const since = new Date(Date.now() - days * DAY_MS);
    since.setUTCHours(0, 0, 0, 0);
    const [stats, numbers, apps, mappings] = await Promise.all([
      this.prisma.whatsappWebhookSignatureStat.groupBy({ by: ['wabaId', 'appId', 'outcome'], where: { day: { gte: since } }, _sum: { count: true } }),
      this.prisma.whatsAppNumber.findMany({ where: { isActive: true }, select: { wabaId: true, tenant: { select: { name: true } } } }),
      this.prisma.whatsappMetaApp.findMany({ select: { appId: true, status: true, secretEnc: true } }),
      this.prisma.whatsappWabaApp.findMany({ select: { wabaId: true, app: { select: { appId: true } } } }),
    ]);

    const byWaba = new Map<string, { valid: number; problems: Record<string, number> }>();
    const totals: Record<string, number> = {};
    for (const s of stats) {
      const n = s._sum.count ?? 0;
      totals[s.outcome] = (totals[s.outcome] ?? 0) + n;
      const entry = byWaba.get(s.wabaId) ?? { valid: 0, problems: {} };
      if (GOOD.has(s.outcome)) entry.valid += n;
      else entry.problems[s.outcome] = (entry.problems[s.outcome] ?? 0) + n;
      byWaba.set(s.wabaId, entry);
    }
    const mappedApps = new Map<string, Set<string>>();
    for (const m of mappings) (mappedApps.get(m.wabaId) ?? mappedApps.set(m.wabaId, new Set()).get(m.wabaId)!).add(m.app.appId);

    const wabas = new Map<string, string>();
    for (const n of numbers) if (!wabas.has(n.wabaId)) wabas.set(n.wabaId, n.tenant.name);

    const coverage: WabaCoverage[] = [...wabas].map(([wabaId, tenant]) => {
      const e = byWaba.get(wabaId) ?? { valid: 0, problems: {} };
      const problemCount = Object.values(e.problems).reduce((a, b) => a + b, 0);
      const requests = e.valid + problemCount;
      const mapped = [...(mappedApps.get(wabaId) ?? [])];
      let verdict: WabaCoverage['verdict'] = 'ready';
      let reason = `${e.valid} verified, no problems`;
      if (requests === 0) { verdict = 'no_traffic'; reason = 'no webhooks in the window, so it cannot be judged'; }
      else if (problemCount > 0) { verdict = 'not_ready'; reason = `${problemCount} request(s) did not verify (${Object.keys(e.problems).join(', ')})`; }
      else if (mapped.length === 0) { verdict = 'not_ready'; reason = 'no Meta app is mapped to this WABA'; }
      else if (e.valid < minValid) { verdict = 'not_ready'; reason = `only ${e.valid} verified request(s); need at least ${minValid}`; }
      return { wabaId, tenant, mappedApps: mapped, requests, valid: e.valid, problems: e.problems, verdict, reason };
    });

    const unattributed = byWaba.get('');
    const unattributedProblems = unattributed ? Object.values(unattributed.problems).reduce((a, b) => a + b, 0) : 0;
    const blockers: string[] = [];
    if (this.signatures.mode === 'off') blockers.push('mode is "off": nothing is being checked or counted');
    const withSecret = apps.filter((a) => a.status === 'ACTIVE' && a.secretEnc);
    if (withSecret.length === 0) blockers.push('no registered Meta app has a secret');
    for (const c of coverage) if (c.verdict === 'not_ready') blockers.push(`WABA …${c.wabaId.slice(-4)} (${c.tenant}): ${c.reason}`);
    if (unattributedProblems > 0) blockers.push(`${unattributedProblems} request(s) that name no WABA did not verify`);
    return {
      mode: this.signatures.mode,
      windowDays: days,
      minValid,
      totals,
      registeredApps: apps.length,
      appsWithSecret: withSecret.length,
      coverage,
      legacyEnvAppId: LEGACY_ENV_APP_ID,
      readyToEnforce: blockers.length === 0 && coverage.some((c) => c.verdict === 'ready'),
      blockers,
    };
  }

  /**
   * Asks Meta which apps are subscribed to each WABA (read-only) and proposes, or with apply=true creates, mappings to apps that are ALREADY
   * registered. An app that is not registered is only reported: this never registers an app or touches a secret.
   */
  async discover(tenantId: string | undefined, apply: boolean) {
    const numbers = await this.prisma.whatsAppNumber.findMany({
      where: { isActive: true, ...(tenantId ? { tenantId } : {}) },
      select: { tenantId: true, wabaId: true, accessToken: true, tenant: { select: { name: true } } },
      distinct: ['tenantId', 'wabaId'],
    });
    const registered = new Map((await this.prisma.whatsappMetaApp.findMany({ select: { appId: true } })).map((a) => [a.appId, true]));
    const results: Array<Record<string, unknown>> = [];
    for (const n of numbers) {
      const token = this.encryption.decrypt(n.accessToken);
      const res = await this.metaClient.list(n.wabaId, token);
      const base = { tenant: n.tenant.name, wabaId: `…${n.wabaId.slice(-4)}` };
      if (!res.ok) { results.push({ ...base, status: 'lookup_failed', httpStatus: res.status, metaCode: res.code, message: res.message }); continue; }
      const mapped: string[] = [];
      const unregistered: Array<{ appId: string; name: string | null }> = [];
      for (const app of res.apps) {
        if (!registered.has(app.appId)) { unregistered.push({ appId: app.appId, name: app.name }); continue; }
        if (apply) await this.mapWaba(app.appId, n.tenantId, n.wabaId, 'discovered');
        mapped.push(app.appId);
      }
      results.push({ ...base, status: res.apps.length === 0 ? 'no_apps_subscribed' : 'ok', applied: apply, mappedToRegisteredApps: mapped, unregisteredApps: unregistered, overrideCallbackHosts: res.apps.map((a) => a.overrideCallbackHost).filter(Boolean) });
    }
    return { lookedUp: numbers.length, apply, results };
  }
}
