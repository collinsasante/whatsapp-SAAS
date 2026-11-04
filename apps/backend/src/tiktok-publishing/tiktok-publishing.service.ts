import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelType, Prisma, TikTokPublication, TikTokPublishStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { StorageService } from '../media/storage.service';
import { CredentialsEncryptionService } from '../common/crypto/credentials-encryption.service';
import {
  TIKTOK_MAX_CAPTION, TIKTOK_MAX_VIDEO_BYTES, TIKTOK_PRIVACY_LEVELS, TIKTOK_VIDEO_MIME_TYPES, TikTokPrivacyLevel,
  describeFailReason, describeRefusal, fetchPublishStatus, hasPublishScope, initDirectPost, queryCreatorInfo, uploadVideo,
} from './tiktok-publish.util';

export const TIKTOK_PUBLISHING_FLAG = 'tiktok_publishing';

const LEASE_MS = 10 * 60_000;
const RUN_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 5;
const POLL_MS = 60_000;
const TOKEN_WAIT_MS = 2 * 60_000;
const GIVE_UP_AFTER_MS = 60 * 60_000;
const TOKEN_SKEW_MS = 60_000;

export interface CreatePublicationInput {
  channelId: string;
  mediaKey: string;
  caption: string;
  privacyLevel?: string;
  idempotencyKey?: string;
}

/** What the API returns: never the media key's storage internals beyond the key itself, never tokens. */
export type PublicationView = Pick<TikTokPublication, 'id' | 'channelId' | 'status' | 'caption' | 'privacyLevel' | 'mediaKey' | 'attempts' | 'lastError' | 'tiktokPostId' | 'createdAt' | 'updatedAt' | 'completedAt'>;

const toView = (p: TikTokPublication): PublicationView => ({
  id: p.id, channelId: p.channelId, status: p.status, caption: p.caption, privacyLevel: p.privacyLevel, mediaKey: p.mediaKey, attempts: p.attempts,
  lastError: p.lastError, tiktokPostId: p.tiktokPostId, createdAt: p.createdAt, updatedAt: p.updatedAt, completedAt: p.completedAt,
});

const backoffMs = (attempts: number) => Math.min(15 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));

@Injectable()
export class TikTokPublishingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TikTokPublishingService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly http: typeof fetch = (input, init) => fetch(input, init);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private audit: AuditService,
    private flags: FeatureFlagsService,
    private storage: StorageService,
    private encryption: CredentialsEncryptionService,
  ) {}

  onModuleInit() {
    if (process.env['NODE_ENV'] === 'test' || this.config.get<string>('TIKTOK_PUBLISH_RUNNER') === 'off') return;
    this.timer = setInterval(() => { void this.runDueOnce().catch((e) => this.logger.error(`TikTok publishing run failed: ${e instanceof Error ? e.name : 'error'}`)); }, RUN_INTERVAL_MS);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ─── configuration and gates ──────────────────────────────────────────────────────────────────────

  /** Privacy levels this app may use. Defaults to "Only me": TikTok limits unaudited apps to it, and a wider list must be set deliberately after the audit. */
  allowedPrivacyLevels(): TikTokPrivacyLevel[] {
    const raw = (this.config.get<string>('TIKTOK_PUBLISH_ALLOWED_PRIVACY') ?? 'SELF_ONLY').split(',').map((s) => s.trim()).filter(Boolean);
    const known = raw.filter((s): s is TikTokPrivacyLevel => (TIKTOK_PRIVACY_LEVELS as readonly string[]).includes(s));
    return known.length > 0 ? known : ['SELF_ONLY'];
  }

  async status(tenantId: string) {
    return { enabled: await this.flags.isEnabled(TIKTOK_PUBLISHING_FLAG, tenantId), allowedPrivacyLevels: this.allowedPrivacyLevels(), maxCaption: TIKTOK_MAX_CAPTION };
  }

  private async assertEnabled(tenantId: string) {
    if (!(await this.flags.isEnabled(TIKTOK_PUBLISHING_FLAG, tenantId))) throw new ForbiddenException('TikTok publishing is not enabled for this workspace.');
  }

  /** Written before the caller moves on, so a crash right after a state change cannot lose its audit entry. A failed write is logged and never breaks publishing. */
  private async audited(tenantId: string, userId: string | undefined, resourceId: string, action: 'CREATE' | 'UPDATE', metadata: Record<string, unknown>): Promise<void> {
    try { await this.audit.log({ tenantId, userId, action, resource: 'tiktok_publication', resourceId, metadata }); }
    catch (e) { this.logger.warn(`Audit write failed for TikTok publication ${resourceId}: ${e instanceof Error ? e.name : 'error'}`); }
  }

  // ─── API operations (every query is scoped by tenantId) ───────────────────────────────────────────

  async create(tenantId: string, userId: string, input: CreatePublicationInput): Promise<PublicationView> {
    await this.assertEnabled(tenantId);
    const caption = input.caption.trim();
    if (!caption) throw new BadRequestException('Write a caption for the video.');
    if (caption.length > TIKTOK_MAX_CAPTION) throw new BadRequestException(`TikTok captions can be at most ${TIKTOK_MAX_CAPTION} characters.`);
    const privacy = (input.privacyLevel ?? this.allowedPrivacyLevels()[0]!) as TikTokPrivacyLevel;
    if (!this.allowedPrivacyLevels().includes(privacy)) throw new BadRequestException(`This app can only post with visibility: ${this.allowedPrivacyLevels().join(', ')}.`);
    // Media must be a file this workspace uploaded: storage keys are prefixed with the tenant id.
    if (!input.mediaKey.startsWith(`${tenantId}/`) || input.mediaKey.includes('..')) throw new BadRequestException('Choose a video from this workspace\'s media library.');

    const channel = await this.prisma.channel.findFirst({ where: { id: input.channelId, tenantId, type: ChannelType.TIKTOK } });
    if (!channel || !channel.isActive) throw new BadRequestException('Connect a TikTok account in Channels first.');
    const creds = (channel.credentials ?? {}) as Record<string, unknown>;
    if (creds['kind'] === 'business_messaging') throw new BadRequestException('This TikTok connection is for messaging. Connect a TikTok account for posting in Channels.');
    if (!hasPublishScope(creds['scope'])) throw new BadRequestException('This TikTok connection was not granted permission to post videos. Reconnect the account and allow posting.');
    if (this.needsReauth(channel.metadata)) throw new BadRequestException('TikTok needs this account to be reconnected before it can post.');

    const idempotencyKey = input.idempotencyKey?.slice(0, 100) || randomUUID();
    try {
      const row = await this.prisma.tikTokPublication.create({
        data: { tenantId, channelId: channel.id, createdById: userId, idempotencyKey, caption, privacyLevel: privacy, mediaKey: input.mediaKey, nextAttemptAt: new Date() },
      });
      await this.audited(tenantId, userId, row.id, 'CREATE', { action: 'TIKTOK_PUBLISH_REQUESTED', channelId: channel.id, privacyLevel: privacy });
      return toView(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.tikTokPublication.findFirst({ where: { tenantId, idempotencyKey } });
        if (existing) return toView(existing); // same request sent twice: one post
      }
      throw e;
    }
  }

  async list(tenantId: string, channelId?: string): Promise<PublicationView[]> {
    const rows = await this.prisma.tikTokPublication.findMany({ where: { tenantId, ...(channelId && { channelId }) }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map(toView);
  }

  async get(tenantId: string, id: string): Promise<PublicationView> {
    const row = await this.prisma.tikTokPublication.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Post not found');
    return toView(row);
  }

  async cancel(tenantId: string, userId: string, id: string): Promise<PublicationView> {
    const r = await this.prisma.tikTokPublication.updateMany({
      where: { id, tenantId, status: TikTokPublishStatus.QUEUED, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }] },
      data: { status: TikTokPublishStatus.CANCELLED, completedAt: new Date() },
    });
    if (r.count === 0) {
      await this.get(tenantId, id); // 404 for another workspace's id
      throw new ConflictException('Only a post that has not started can be cancelled.');
    }
    await this.audited(tenantId, userId, id, 'UPDATE', { action: 'TIKTOK_PUBLISH_CANCELLED' });
    return this.get(tenantId, id);
  }

  /**
   * Retry after a failure. FAILED starts a fresh upload (nothing was posted). NEEDS_RECONNECT carries on from where it stopped (a post that TikTok already
   * has is only checked, never sent again). UNCERTAIN may already be live on TikTok, so it needs the person to confirm they checked.
   */
  async retry(tenantId: string, userId: string, id: string, confirmNotPosted = false): Promise<PublicationView> {
    await this.assertEnabled(tenantId);
    const row = await this.prisma.tikTokPublication.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Post not found');
    if (row.status === TikTokPublishStatus.UNCERTAIN && !confirmNotPosted) {
      throw new ConflictException('TikTok may already have published this video. Check the account on TikTok, then confirm it is not there to try again.');
    }
    const next = row.status === TikTokPublishStatus.NEEDS_RECONNECT && row.publishId ? TikTokPublishStatus.PROCESSING
      : ([TikTokPublishStatus.FAILED, TikTokPublishStatus.UNCERTAIN, TikTokPublishStatus.NEEDS_RECONNECT] as TikTokPublishStatus[]).includes(row.status) ? TikTokPublishStatus.QUEUED
      : null;
    if (!next) throw new ConflictException('This post cannot be retried.');
    const fresh = next === TikTokPublishStatus.QUEUED;
    const r = await this.prisma.tikTokPublication.updateMany({
      where: { id, tenantId, status: row.status },
      data: { status: next, nextAttemptAt: new Date(), lastError: null, completedAt: null, leaseOwner: null, leaseExpiresAt: null, ...(fresh && { publishId: null, attempts: 0 }) },
    });
    if (r.count === 0) throw new ConflictException('This post changed while you were retrying it. Refresh and look again.');
    await this.audited(tenantId, userId, id, 'UPDATE', { action: 'TIKTOK_PUBLISH_RETRIED', from: row.status, confirmedNotPosted: row.status === TikTokPublishStatus.UNCERTAIN });
    return this.get(tenantId, id);
  }

  // ─── the runner ───────────────────────────────────────────────────────────────────────────────────

  /** One pass. Safe to run on several replicas at once: every step is claimed with a compare-and-set on status and lease. */
  async runDueOnce(now: Date = new Date()): Promise<{ processed: number }> {
    if (this.running) return { processed: 0 };
    this.running = true;
    try {
      await this.recoverStale(now);
      const due = await this.prisma.tikTokPublication.findMany({
        where: { status: { in: [TikTokPublishStatus.QUEUED, TikTokPublishStatus.PROCESSING] }, nextAttemptAt: { lte: now } },
        orderBy: { nextAttemptAt: 'asc' }, take: 10,
      });
      let processed = 0;
      for (const row of due) {
        if (!(await this.flags.isEnabledCached(TIKTOK_PUBLISHING_FLAG, row.tenantId).catch(() => false))) continue; // switched off: leave it untouched
        const owner = randomUUID();
        const claimed = await this.prisma.tikTokPublication.updateMany({
          where: { id: row.id, status: row.status, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
          data: row.status === TikTokPublishStatus.QUEUED
            ? { status: TikTokPublishStatus.UPLOADING, attempts: { increment: 1 }, leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), lastError: null }
            : { leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
        });
        if (claimed.count === 0) continue;
        processed++;
        try {
          if (row.status === TikTokPublishStatus.QUEUED) await this.startUpload(row.id, owner, now);
          else await this.checkProgress(row.id, owner, now);
        } catch (e) {
          // Anything unexpected after a request may have reached TikTok is treated as uncertain rather than retried.
          this.logger.error(`TikTok publication ${row.id} step failed unexpectedly: ${e instanceof Error ? e.name : 'error'}`);
          await this.settle(row.id, owner, row.tenantId, TikTokPublishStatus.UNCERTAIN, 'Something went wrong while sending this to TikTok. It may or may not have been posted. Check TikTok before retrying.');
        }
      }
      return { processed };
    } finally { this.running = false; }
  }

  /** A run that died mid-upload leaves status UPLOADING with an expired lease. */
  private async recoverStale(now: Date) {
    const stale = await this.prisma.tikTokPublication.findMany({ where: { status: TikTokPublishStatus.UPLOADING, leaseExpiresAt: { lt: now } }, take: 50 });
    for (const row of stale) {
      const data = row.publishId
        ? { status: TikTokPublishStatus.FAILED, lastError: 'The upload to TikTok was interrupted. Nothing was posted; you can try again.' }
        : { status: TikTokPublishStatus.UNCERTAIN, lastError: 'The app stopped while sending this to TikTok. It may or may not have been posted. Check TikTok before retrying.' };
      const r = await this.prisma.tikTokPublication.updateMany({
        where: { id: row.id, status: TikTokPublishStatus.UPLOADING, leaseOwner: row.leaseOwner, leaseExpiresAt: { lt: now } },
        data: { ...data, leaseOwner: null, leaseExpiresAt: null, completedAt: now },
      });
      if (r.count) await this.audited(row.tenantId, undefined, row.id, 'UPDATE', { action: 'TIKTOK_PUBLISH_RECOVERED', to: data.status });
    }
  }

  /** Writes the next state only while this runner still holds the lease. */
  private async settle(id: string, owner: string, tenantId: string, status: TikTokPublishStatus, lastError: string | null, extra: Prisma.TikTokPublicationUpdateManyMutationInput = {}) {
    const terminal = ([TikTokPublishStatus.PUBLISHED, TikTokPublishStatus.FAILED, TikTokPublishStatus.UNCERTAIN, TikTokPublishStatus.NEEDS_RECONNECT] as TikTokPublishStatus[]).includes(status);
    const r = await this.prisma.tikTokPublication.updateMany({
      where: { id, leaseOwner: owner },
      data: { status, lastError, leaseOwner: null, leaseExpiresAt: null, ...(terminal && { completedAt: new Date() }), ...extra },
    });
    if (r.count && terminal) await this.audited(tenantId, undefined, id, 'UPDATE', { action: 'TIKTOK_PUBLISH_RESULT', status });
    return r.count > 0;
  }

  private needsReauth(metadata: unknown): boolean {
    const auth = (metadata as { tiktokAuth?: { status?: string } } | null)?.tiktokAuth;
    return auth?.status === 'REAUTH_REQUIRED';
  }

  private async token(channelId: string, tenantId: string, now: Date): Promise<{ state: 'ok'; token: string } | { state: 'expired' | 'reconnect' }> {
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, tenantId, type: ChannelType.TIKTOK } });
    if (!channel || !channel.isActive || this.needsReauth(channel.metadata)) return { state: 'reconnect' };
    const creds = (channel.credentials ?? {}) as Record<string, unknown>;
    if (creds['kind'] === 'business_messaging' || typeof creds['accessToken'] !== 'string' || !creds['accessToken'] || !hasPublishScope(creds['scope'])) return { state: 'reconnect' };
    const exp = typeof creds['tokenExpiresAt'] === 'string' ? Date.parse(creds['tokenExpiresAt']) : NaN;
    if (!Number.isNaN(exp) && exp <= now.getTime() + TOKEN_SKEW_MS) return { state: 'expired' };
    try { return { state: 'ok', token: this.encryption.decrypt(creds['accessToken']) }; } catch { return { state: 'reconnect' }; }
  }

  private async startUpload(id: string, owner: string, now: Date) {
    const row = await this.prisma.tikTokPublication.findUniqueOrThrow({ where: { id } });
    const t = await this.token(row.channelId, row.tenantId, now);
    if (t.state !== 'ok') {
      if (t.state === 'reconnect' || now.getTime() - row.createdAt.getTime() > GIVE_UP_AFTER_MS) {
        await this.settle(id, owner, row.tenantId, TikTokPublishStatus.NEEDS_RECONNECT, 'TikTok needs this account to be reconnected before it can post.');
      } else {
        // The refresh worker renews the token shortly; waiting does not count as an attempt.
        await this.settle(id, owner, row.tenantId, TikTokPublishStatus.QUEUED, 'Waiting for the TikTok sign-in to refresh.', { nextAttemptAt: new Date(now.getTime() + TOKEN_WAIT_MS), attempts: { decrement: 1 } });
      }
      return;
    }

    const media = await this.storage.downloadBuffer(row.mediaKey);
    if (!media) return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.FAILED, 'The video file could not be found in the media library.');
    const mime = media.mimeType.split(';')[0]!.trim().toLowerCase();
    if (!(TIKTOK_VIDEO_MIME_TYPES as readonly string[]).includes(mime)) return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.FAILED, 'TikTok accepts MP4, MOV or WebM videos.');
    if (media.buffer.length === 0 || media.buffer.length > TIKTOK_MAX_VIDEO_BYTES) return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.FAILED, `The video must be larger than 0 and at most ${TIKTOK_MAX_VIDEO_BYTES / 1024 / 1024} MB.`);

    // TikTok requires this query before a post. It changes nothing at TikTok, so an unclear answer is safe to retry; a posting limit or a bad token ends the attempt now.
    const creator = await queryCreatorInfo(this.http, t.token);
    if (creator.kind === 'unavailable' || (creator.kind === 'refused' && creator.retry)) {
      const why = creator.kind === 'refused' ? describeRefusal(creator.code, creator.message) : 'TikTok could not be reached.';
      if (row.attempts >= MAX_ATTEMPTS) return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.FAILED, `${why} Gave up after ${row.attempts} attempts.`);
      return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.QUEUED, why, { nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts)) });
    }
    if (creator.kind === 'refused') {
      return void await this.settle(id, owner, row.tenantId, creator.reconnect ? TikTokPublishStatus.NEEDS_RECONNECT : TikTokPublishStatus.FAILED,
        creator.reconnect ? 'TikTok no longer accepts this connection. Reconnect the account.' : describeRefusal(creator.code, creator.message));
    }
    if (!creator.privacyOptions.includes(row.privacyLevel)) {
      const labels: Record<string, string> = { SELF_ONLY: 'Only me', FOLLOWER_OF_CREATOR: 'Followers', MUTUAL_FOLLOW_FRIENDS: 'Friends', PUBLIC_TO_EVERYONE: 'Everyone' };
      return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.FAILED, `This TikTok account cannot post with that visibility. It allows: ${creator.privacyOptions.map((p) => labels[p] ?? p).join(', ') || 'nothing right now'}.`);
    }
    if (creator.maxDurationSec !== undefined && creator.maxDurationSec <= 0) return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.FAILED, 'This TikTok account cannot post videos right now.');

    const init = await initDirectPost(this.http, t.token, {
      caption: row.caption, privacyLevel: row.privacyLevel as TikTokPrivacyLevel, videoSize: media.buffer.length,
      disableComment: creator.commentDisabled, disableDuet: creator.duetDisabled, disableStitch: creator.stitchDisabled,
    });
    if (init.kind === 'unknown') {
      return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.UNCERTAIN, 'TikTok did not confirm this post. It may or may not have been published. Check TikTok before retrying.');
    }
    if (init.kind === 'not-sent' || (init.kind === 'refused' && init.retry)) {
      const attempts = row.attempts;
      const why = init.kind === 'refused' ? describeRefusal(init.code, init.message) : 'TikTok could not be reached.';
      if (attempts >= MAX_ATTEMPTS) return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.FAILED, `${why} Gave up after ${attempts} attempts.`);
      return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.QUEUED, why, { nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) });
    }
    if (init.kind === 'refused') {
      return void await this.settle(id, owner, row.tenantId, init.reconnect ? TikTokPublishStatus.NEEDS_RECONNECT : TikTokPublishStatus.FAILED,
        init.reconnect ? 'TikTok no longer accepts this connection. Reconnect the account.' : describeRefusal(init.code, init.message));
    }

    // From here TikTok knows about this post. Record its id before sending bytes so a crash can never lose track of it.
    const saved = await this.prisma.tikTokPublication.updateMany({ where: { id, leaseOwner: owner }, data: { publishId: init.publishId, mediaSize: media.buffer.length } });
    if (saved.count === 0) return; // lost the lease: the stale-run recovery decides what this becomes
    const upErr = await uploadVideo(this.http, init.uploadUrl, media.buffer, mime);
    if (upErr) return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.FAILED, `${upErr}. Nothing was posted; you can try again.`);
    await this.settle(id, owner, row.tenantId, TikTokPublishStatus.PROCESSING, null, { nextAttemptAt: new Date(now.getTime() + 30_000) });
  }

  private async checkProgress(id: string, owner: string, now: Date) {
    const row = await this.prisma.tikTokPublication.findUniqueOrThrow({ where: { id } });
    if (!row.publishId) return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.UNCERTAIN, 'TikTok did not give this post an id. It may or may not have been published. Check TikTok before retrying.');
    const t = await this.token(row.channelId, row.tenantId, now);
    if (t.state !== 'ok') {
      if (t.state === 'reconnect') await this.settle(id, owner, row.tenantId, TikTokPublishStatus.NEEDS_RECONNECT, 'TikTok needs this account to be reconnected. The video was already sent; reconnect to see its result.');
      else await this.settle(id, owner, row.tenantId, TikTokPublishStatus.PROCESSING, 'Waiting for the TikTok sign-in to refresh.', { nextAttemptAt: new Date(now.getTime() + TOKEN_WAIT_MS) });
      return;
    }

    const s = await fetchPublishStatus(this.http, t.token, row.publishId);
    if (s.kind === 'published') return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.PUBLISHED, null, { tiktokPostId: s.postId });
    // TikTok has ended this post. Even when the reason is a removed authorisation (the message says to reconnect) the post itself cannot complete, so it is FAILED:
    // a retry would only be told the same thing. The person reconnects and posts again.
    if (s.kind === 'failed') return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.FAILED, describeFailReason(s.code).message);
    if (s.kind === 'reconnect') return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.NEEDS_RECONNECT, 'TikTok needs this account to be reconnected. The video was already sent; reconnect to see its result.');
    if (now.getTime() - row.createdAt.getTime() > GIVE_UP_AFTER_MS) {
      return void await this.settle(id, owner, row.tenantId, TikTokPublishStatus.UNCERTAIN, 'TikTok is still processing this video after an hour. It may still be published. Check TikTok.');
    }
    await this.settle(id, owner, row.tenantId, TikTokPublishStatus.PROCESSING, null, { nextAttemptAt: new Date(now.getTime() + POLL_MS) });
  }
}
