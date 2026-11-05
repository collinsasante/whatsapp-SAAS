import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialsEncryptionService } from '../../common/crypto/credentials-encryption.service';
import {
  SignatureDecision,
  SignatureEvaluation,
  SignatureMode,
  SigningApp,
  decideSignature,
  evaluateSignature,
  extractWabaIds,
  resolveSignatureMode,
} from './signature-policy.util';

/** Registered apps change rarely; a short cache keeps the database off the webhook path. Admin edits invalidate it at once. */
const REGISTRY_TTL_MS = 60_000;
/** A repeated non-valid outcome for the same WABA and app is logged at most this often (and counted either way). */
const LOG_THROTTLE_MS = 60_000;
const ENCRYPTED_PREFIX = 'enc:v1:';

export const LEGACY_ENV_APP_ID = 'env:WHATSAPP_APP_SECRET';
/** Statistics bucket for WABA ids this platform does not have (see recordStats). */
export const UNKNOWN_WABA_BUCKET = 'unknown';

export interface WebhookSignatureVerdict extends SignatureDecision {
  mode: SignatureMode;
  evaluation: SignatureEvaluation;
}

/**
 * Verifies inbound WhatsApp webhooks against the per-app registry (see signature-policy.util.ts) and records what it concluded.
 * In `observe` mode (the production default) it never rejects: it only measures, so enforcement can be switched on with evidence.
 */
@Injectable()
export class WhatsappWebhookSignatureService {
  private readonly logger = new Logger(WhatsappWebhookSignatureService.name);
  readonly mode: SignatureMode;
  private cache: { apps: SigningApp[]; knownWabas: ReadonlySet<string>; loadedAt: number } | null = null;
  private lastLogged = new Map<string, number>();
  private suppressed = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialsEncryptionService,
    private readonly config: ConfigService,
  ) {
    const resolved = resolveSignatureMode(this.config.get<string>('WHATSAPP_WEBHOOK_SIGNATURE_MODE'), this.config.get<string>('NODE_ENV'));
    this.mode = resolved.mode;
    if (resolved.ignoredValue) {
      this.logger.error(`WHATSAPP_WEBHOOK_SIGNATURE_MODE has an unrecognised value ("${resolved.ignoredValue}"); using the default "${this.mode}". Valid values: off, observe, enforce.`);
    }
    if (this.mode === 'observe') {
      this.logger.warn(`WhatsApp webhook signatures: mode=observe${resolved.explicit ? '' : ' (default in production)'}. Signatures are checked and counted but NEVER rejected.`);
    } else if (this.mode === 'enforce') {
      this.logger.log(`WhatsApp webhook signatures: mode=enforce${resolved.explicit ? '' : ' (default outside production)'}. Requests that do not verify are rejected.`);
    } else {
      this.logger.warn('WhatsApp webhook signatures: mode=off. Nothing is checked.');
    }
  }

  /** Called by admin edits so a new secret or mapping applies on the next request, not after the cache expires. */
  invalidate(): void {
    this.cache = null;
  }

  async verify(rawBody: Buffer | undefined, signatureHeader: string | undefined, entries: unknown): Promise<WebhookSignatureVerdict> {
    if (this.mode === 'off') {
      return { mode: this.mode, accept: true, degraded: false, evaluation: { outcome: 'no_secrets', appId: null, wabaIds: [] } };
    }
    const { apps, knownWabas } = await this.loadRegistry();
    const evaluation = evaluateSignature({ rawBody, header: signatureHeader, apps, wabaIds: extractWabaIds(entries) });
    const decision = decideSignature(this.mode, evaluation.outcome);
    this.report(evaluation, decision);
    void this.recordStats(evaluation, knownWabas).catch((err) => this.logger.warn(`Could not record webhook signature statistics: ${err instanceof Error ? err.message : 'unknown error'}`));
    return { mode: this.mode, ...decision, evaluation };
  }

  private async loadRegistry(): Promise<{ apps: SigningApp[]; knownWabas: ReadonlySet<string> }> {
    if (this.cache && Date.now() - this.cache.loadedAt < REGISTRY_TTL_MS) return this.cache;
    const apps: SigningApp[] = [];
    let knownWabas: ReadonlySet<string> = this.cache?.knownWabas ?? new Set();
    try {
      const rows = await this.prisma.whatsappMetaApp.findMany({
        where: { status: 'ACTIVE', secretEnc: { not: null } },
        select: { appId: true, secretEnc: true, mappings: { select: { wabaId: true } } },
      });
      for (const row of rows) {
        const stored = row.secretEnc ?? '';
        // Only ever stored encrypted. Anything else (an unreadable row, or a plaintext value written around the API) is skipped, never used.
        if (!stored.startsWith(ENCRYPTED_PREFIX)) {
          this.logger.error(`Registered Meta app ${row.appId} has a secret that is not in encrypted form; it is ignored.`);
          continue;
        }
        const secret = this.encryption.decrypt(stored);
        if (!secret || secret.startsWith(ENCRYPTED_PREFIX)) {
          this.logger.error(`Registered Meta app ${row.appId}: the secret could not be decrypted (is CREDENTIALS_ENCRYPTION_KEY the one it was stored with?); it is ignored.`);
          continue;
        }
        apps.push({ appId: row.appId, secret, wabaIds: new Set(row.mappings.map((m) => m.wabaId)) });
      }
      knownWabas = new Set((await this.prisma.whatsAppNumber.findMany({ select: { wabaId: true }, distinct: ['wabaId'] })).map((n) => n.wabaId));
    } catch (err) {
      // A stale registry is better than none: reuse the last good copy rather than treating every webhook as unverifiable.
      this.logger.error(`Could not load the Meta app registry: ${err instanceof Error ? err.message : 'unknown error'}${this.cache ? ' (using the previous copy)' : ''}`);
      if (this.cache) return this.cache;
    }
    const legacy = this.config.get<string>('WHATSAPP_APP_SECRET');
    if (legacy) apps.push({ appId: LEGACY_ENV_APP_ID, secret: legacy, wabaIds: 'all' });
    this.cache = { apps, knownWabas, loadedAt: Date.now() };
    return this.cache;
  }

  /** Structured, rate-limited log lines. Valid requests are not logged at all (they are counted). WABA ids are shortened to their last four digits. */
  private report(evaluation: SignatureEvaluation, decision: SignatureDecision): void {
    if (evaluation.outcome === 'valid' || evaluation.outcome === 'valid_no_waba') return;
    const tails = evaluation.wabaIds.map((w) => `…${w.slice(-4)}`).join(',') || '-';
    const key = `${evaluation.outcome}|${evaluation.appId ?? '-'}|${tails}`;
    const now = Date.now();
    const last = this.lastLogged.get(key) ?? 0;
    if (now - last < LOG_THROTTLE_MS) {
      this.suppressed.set(key, (this.suppressed.get(key) ?? 0) + 1);
      return;
    }
    const repeats = this.suppressed.get(key) ?? 0;
    this.lastLogged.set(key, now);
    this.suppressed.delete(key);
    if (this.lastLogged.size > 500) this.lastLogged.clear();
    const line = `whatsapp_webhook_signature outcome=${evaluation.outcome} mode=${this.mode} app=${evaluation.appId ?? '-'} wabas=${tails} accepted=${decision.accept}${repeats ? ` repeats_since_last_log=${repeats}` : ''}`;
    if (decision.degraded) this.logger.error(`${line} (enforce requested but no Meta app secret is registered: request let through)`);
    else if (!decision.accept) this.logger.warn(line);
    else this.logger.log(line);
  }

  /**
   * Counters are keyed by WABA, and the WABA id comes from a payload nobody has authenticated yet. Only ids of WABAs this platform actually has are
   * recorded under their own name; anything else shares one bucket, so a flood of invented ids cannot create unbounded rows.
   */
  private async recordStats(evaluation: SignatureEvaluation, knownWabas: ReadonlySet<string>): Promise<void> {
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const appId = evaluation.appId ?? '';
    const buckets = new Set(evaluation.wabaIds.map((w) => (knownWabas.has(w) ? w : UNKNOWN_WABA_BUCKET)));
    for (const wabaId of buckets.size > 0 ? buckets : new Set([''])) {
      const key = { day, wabaId, appId, outcome: evaluation.outcome };
      try {
        await this.prisma.whatsappWebhookSignatureStat.upsert({
          where: { day_wabaId_appId_outcome: key },
          create: { ...key, count: 1 },
          update: { count: { increment: 1 }, lastSeenAt: now },
        });
      } catch (err) {
        // Two first-of-the-day requests can race to create the same row; the loser's increment is applied as a plain update.
        if ((err as { code?: string })?.code !== 'P2002') throw err;
        await this.prisma.whatsappWebhookSignatureStat.update({ where: { day_wabaId_appId_outcome: key }, data: { count: { increment: 1 }, lastSeenAt: now } });
      }
    }
  }
}
