import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, forwardRef } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MessageDirection, MessageType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../media/storage.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AiCreditsService, AiSpendCapReachedError, InsufficientAiCreditsError } from '../ai-core/credits/ai-credits.service';
import { MessagesService } from '../messages/messages.service';
import { transcodeToM4a } from '../common/media/audio.util';
import { describeErrorForLog } from '../common/privacy/prompt-redaction.util';
import { DEFAULT_LIMITS, validateAudio, validateImage } from './media-validation.util';
import { EnrichmentConfig, EnrichmentProviderError, describeImage, loadEnrichmentConfig, transcribeAudio } from './enrichment-providers';

import { EnrichmentKind, KIND_IMAGE, KIND_TRANSCRIPT, labelForAi } from './enrichment-labels';

export { KIND_IMAGE, KIND_TRANSCRIPT, labelForAi };
type Kind = EnrichmentKind;

const LEASE_MS = 3 * 60_000;
const RUN_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 3;
const BATCH = 10;

/** Business decision, like the legacy responder's flat cost: credits per successful call. Tunable by environment, not a measured provider cost. */
const creditCost = (kind: Kind): number => {
  const raw = Number(process.env[kind === KIND_TRANSCRIPT ? 'VOICE_TRANSCRIPTION_CREDITS' : 'IMAGE_UNDERSTANDING_CREDITS']);
  return Number.isSafeInteger(raw) && raw >= 0 && raw <= 1000 ? raw : kind === KIND_TRANSCRIPT ? 3 : 2;
};

export const ENRICHMENT_SELECT = { kind: true, status: true, text: true, language: true, durationSec: true, errorCode: true } as const;

@Injectable()
export class MessageEnrichmentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageEnrichmentService.name);
  private timer?: NodeJS.Timeout;
  /** Runs in this process are queued one after another; across processes the per-row lease is what keeps a job single. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Replaceable in tests. */
  http: typeof fetch = (input, init) => fetch(input, init);
  config: () => EnrichmentConfig = () => loadEnrichmentConfig();

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private realtime: RealtimeService,
    private credits: AiCreditsService,
    @Inject(forwardRef(() => MessagesService)) private messages: MessagesService,
  ) {}

  onModuleInit() {
    if (process.env['NODE_ENV'] === 'test') return;
    this.timer = setInterval(() => { void this.processDue().catch((e) => this.logger.error(`Enrichment run failed: ${describeErrorForLog(e)}`)); }, RUN_INTERVAL_MS);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** What this server can do at all, independent of any workspace. */
  availability() {
    const c = this.config();
    return {
      transcription: { available: !!c.transcription, reason: c.transcriptionReason },
      vision: { available: !!c.vision, reason: c.visionReason },
    };
  }

  /** Called after an inbound message is stored. Never throws: a failure here must not lose the message. */
  async schedule(tenantId: string, messageId: string): Promise<void> {
    try {
      const msg = await this.prisma.message.findFirst({ where: { id: messageId, tenantId }, select: { id: true, type: true, direction: true, mediaUrl: true } });
      if (!msg || msg.direction !== MessageDirection.INBOUND || !msg.mediaUrl) return;
      const kind: Kind | null = msg.type === MessageType.AUDIO ? KIND_TRANSCRIPT : msg.type === MessageType.IMAGE ? KIND_IMAGE : null;
      if (!kind) return;
      const settings = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { voiceTranscriptionEnabled: true, imageUnderstandingEnabled: true } });
      if (!(kind === KIND_TRANSCRIPT ? settings?.voiceTranscriptionEnabled : settings?.imageUnderstandingEnabled)) return;     // off: no row, no cost, nothing sent anywhere
      const c = this.config();
      const unavailable = kind === KIND_TRANSCRIPT ? !c.transcription : !c.vision;
      await this.prisma.messageEnrichment.createMany({
        data: [{ tenantId, messageId, kind, ...(unavailable && { status: 'SKIPPED', errorCode: 'provider_unavailable' }) }],
        skipDuplicates: true,                                             // a repeated webhook delivery cannot create a second job
      });
      if (!unavailable) void this.processDue().catch((e) => this.logger.warn(`Enrichment run failed: ${describeErrorForLog(e)}`));
    } catch (e) {
      this.logger.warn(`Could not schedule enrichment for a message: ${describeErrorForLog(e)}`);
    }
  }

  processDue(now: Date = new Date()): Promise<{ processed: number }> {
    const run = this.queue.then(() => this.processDueNow(now));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async processDueNow(now: Date): Promise<{ processed: number }> {
    {
      await this.recoverStale(now);
      const due = await this.prisma.messageEnrichment.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: 'asc' }, take: BATCH });
      let processed = 0;
      for (const row of due) {
        const owner = randomUUID();
        const claimed = await this.prisma.messageEnrichment.updateMany({
          where: { id: row.id, status: 'PENDING', OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
          data: { status: 'PROCESSING', attempts: { increment: 1 }, leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
        });
        if (claimed.count === 0) continue;            // another worker took it
        processed++;
        try { await this.run(row.id, owner, now); }
        catch (e) { this.logger.error(`Enrichment ${row.id.slice(-6)} failed unexpectedly: ${describeErrorForLog(e)}`); await this.settle(row.id, owner, { status: 'FAILED', errorCode: 'internal_error' }); }
      }
      return { processed };
    }
  }

  /** A worker that died mid-run leaves PROCESSING with an expired lease: try again if attempts remain, otherwise give up. */
  private async recoverStale(now: Date) {
    const stale = await this.prisma.messageEnrichment.findMany({ where: { status: 'PROCESSING', leaseExpiresAt: { lt: now } }, take: 50, select: { id: true, attempts: true, leaseOwner: true } });
    for (const s of stale) {
      await this.prisma.messageEnrichment.updateMany({
        where: { id: s.id, status: 'PROCESSING', leaseOwner: s.leaseOwner },
        data: s.attempts >= MAX_ATTEMPTS ? { status: 'FAILED', errorCode: 'interrupted', leaseOwner: null, leaseExpiresAt: null } : { status: 'PENDING', leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: now },
      });
    }
  }

  private settle(id: string, owner: string, data: { status: string; errorCode?: string | null; text?: string | null; language?: string | null; durationSec?: number | null; provider?: string | null; model?: string | null; creditsCharged?: number; nextAttemptAt?: Date }) {
    return this.prisma.messageEnrichment.updateMany({ where: { id, leaseOwner: owner }, data: { ...data, leaseOwner: null, leaseExpiresAt: null } });
  }

  private async run(id: string, owner: string, now: Date) {
    const row = await this.prisma.messageEnrichment.findUniqueOrThrow({ where: { id } });
    const kind = row.kind as Kind;
    const [msg, settings] = await Promise.all([
      this.prisma.message.findFirst({ where: { id: row.messageId, tenantId: row.tenantId }, select: { id: true, mediaUrl: true, conversationId: true } }),
      this.prisma.tenantSettings.findUnique({ where: { tenantId: row.tenantId }, select: { voiceTranscriptionEnabled: true, imageUnderstandingEnabled: true } }),
    ]);
    const enabled = kind === KIND_TRANSCRIPT ? settings?.voiceTranscriptionEnabled : settings?.imageUnderstandingEnabled;
    if (!msg || !enabled) return void await this.settle(id, owner, { status: 'SKIPPED', errorCode: 'disabled' });

    const cfg = this.config();
    const endpoint = kind === KIND_TRANSCRIPT ? cfg.transcription : cfg.vision;
    if (!endpoint) return void await this.settle(id, owner, { status: 'SKIPPED', errorCode: 'provider_unavailable' });

    // Media comes only from this workspace's own storage: the key must start with the tenant id, and no other URL is ever fetched.
    const key = /\/api\/v1\/media\/serve\/(.+)$/.exec(msg.mediaUrl ?? '')?.[1]?.replace(/~/g, '/');
    if (!key || !key.startsWith(`${row.tenantId}/`) || key.includes('..')) return void await this.settle(id, owner, { status: 'SKIPPED', errorCode: 'media_unavailable' });
    const file = await this.storage.downloadBuffer(key);
    if (!file) return void await this.settle(id, owner, { status: 'FAILED', errorCode: 'media_unavailable' });

    let audio: { buffer: Buffer; mime: string; ext: string } | undefined;
    let image: { buffer: Buffer; mime: string } | undefined;
    if (kind === KIND_TRANSCRIPT) {
      let buffer = file.buffer;
      let verdict = validateAudio(buffer, DEFAULT_LIMITS);
      if (!verdict.ok) return void await this.settle(id, owner, { status: 'FAILED', errorCode: verdict.code });
      if (!verdict.info.providerReadable) {
        // AMR / bare AAC (what some phones send) are converted first; a file that will not convert is corrupt for our purposes.
        try { buffer = await transcodeToM4a(buffer); } catch { return void await this.settle(id, owner, { status: 'FAILED', errorCode: 'unsupported_format' }); }
        verdict = validateAudio(buffer, DEFAULT_LIMITS);
        if (!verdict.ok) return void await this.settle(id, owner, { status: 'FAILED', errorCode: 'unsupported_format' });
      }
      audio = { buffer, mime: verdict.info.mime, ext: verdict.info.ext };
    } else {
      const verdict = validateImage(file.buffer, DEFAULT_LIMITS);
      if (!verdict.ok) return void await this.settle(id, owner, { status: 'FAILED', errorCode: verdict.code });
      image = { buffer: file.buffer, mime: verdict.info.mime };
    }

    const cost = creditCost(kind);
    let reservationId: string | undefined;
    if (cost > 0) {
      try { reservationId = (await this.credits.reserveFixedCredits(row.tenantId, cost)).id; }
      catch (e) {
        if (e instanceof InsufficientAiCreditsError) return void await this.settle(id, owner, { status: 'SKIPPED', errorCode: e instanceof AiSpendCapReachedError ? 'spend_cap_reached' : 'insufficient_credits' });
        throw e;
      }
    }

    try {
      const out = kind === KIND_TRANSCRIPT ? await transcribeAudio(endpoint, audio!, this.http) : await describeImage(endpoint, image!, this.http);
      let charged = 0;
      if (reservationId) {
        try {
          const s = await this.credits.settleReservation(reservationId, cost, kind === KIND_TRANSCRIPT ? 'Voice note transcription' : 'Image understanding', { enrichmentKind: kind });
          if (s.settled) charged = cost; else this.logger.error(`Enrichment reservation ${reservationId} was not settled; it stays held and will expire`);
        } catch (e) { this.logger.error(`Enrichment settlement failed (reservation stays held): ${describeErrorForLog(e)}`); }
      }
      const language = 'language' in out && typeof out.language === 'string' ? out.language : null;
      const durationSec = 'durationSec' in out && typeof out.durationSec === 'number' ? out.durationSec : null;
      const wrote = await this.settle(id, owner, { status: 'COMPLETED', text: out.text, language, durationSec, provider: new URL(endpoint.baseUrl).hostname, model: out.model, errorCode: null, creditsCharged: charged });
      if (wrote.count === 1) await this.afterCompleted(row.tenantId, row.messageId, msg.conversationId, kind, out.text);
    } catch (e) {
      if (!(e instanceof EnrichmentProviderError)) throw e;
      // A definite refusal before the provider did anything gives the credits back; a lost answer keeps the hold (it expires) because the work may be done.
      if (reservationId && !e.uncertain) await this.credits.releaseReservation(reservationId).catch(() => undefined);
      if (e.code === 'auth') this.logger.error('The enrichment provider rejected our API key; voice/image understanding is failing until it is fixed');
      const retry = e.retryable && row.attempts < MAX_ATTEMPTS;
      await this.settle(id, owner, retry
        ? { status: 'PENDING', errorCode: e.code, nextAttemptAt: new Date(now.getTime() + 30_000 * 2 ** (row.attempts)) }
        : { status: 'FAILED', errorCode: e.code === 'auth' ? 'provider_auth' : e.code });
    }
  }

  private async afterCompleted(tenantId: string, messageId: string, conversationId: string, kind: Kind, text: string) {
    try {
      const full = await this.prisma.message.findFirst({ where: { id: messageId, tenantId }, include: { enrichments: { select: ENRICHMENT_SELECT } } });
      if (full) this.realtime.emitNewMessage(tenantId, conversationId, full as unknown as Record<string, unknown>);
    } catch (e) { this.logger.warn(`Could not announce an enrichment: ${describeErrorForLog(e)}`); }
    // A voice note IS the customer's question, so a transcript is answered like typed text. A picture is context only: the customer's caption (if any)
    // was already answered, and a bare picture does not by itself call for a reply.
    if (kind === KIND_TRANSCRIPT && text) {
      await this.messages.dispatchAiForEnrichment(tenantId, messageId, labelForAi(kind, text))
        .catch((e) => this.logger.warn(`AI dispatch for a transcript failed: ${describeErrorForLog(e)}`));
    }
  }
}
