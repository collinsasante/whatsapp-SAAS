import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelType, ConversationStatus, MessageDirection, MessageStatus, MessageType, Prisma } from '@prisma/client';
import { MessageType as SharedMessageType } from '@whatsapp-platform/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { CredentialsEncryptionService } from '../common/crypto/credentials-encryption.service';
import { StorageService } from '../media/storage.service';
import { ContactsService } from '../contacts/contacts.service';
import { MessagesService } from '../messages/messages.service';
import { signOAuthState } from '../channels/oauth-state.util';
import { CONTRACT, PROVIDER_REQUIREMENTS, TIKTOK_BUSINESS_API_BASE, unconfirmedContractItems } from './tiktok-messaging.contract';
import * as client from './tiktok-messaging.client';
import {
  describeSendFailure, isAuthFailure, normaliseTikTokEvent, tiktokMessageKey, validateOutboundImage, validateOutboundText, verifyTikTokSignature,
  TikTokInboundEvent,
} from './tiktok-messaging.util';

export const TIKTOK_MESSAGING_FLAG = 'tiktok_messaging';
export const CHANNEL_KIND = 'business_messaging';
const REFRESH_SKEW_MS = 5 * 60_000;
const MAX_HISTORY_CONVERSATIONS = 200;
const MAX_HISTORY_MESSAGES = 500;

export type WebhookOutcome = { status: 'stored' | 'duplicate' | 'ignored'; reason?: string };

interface MessagingCreds { accessToken: string; refreshToken: string; businessId: string; tokenExpiresAt?: string; refreshExpiresAt?: string }

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * TikTok Business Messaging: connection, inbound webhook, outbound sends, history. Everything that depends on TikTok's wire format goes through
 * tiktok-messaging.client.ts / .util.ts, whose contract is NOT verified against a real account (see tiktok-messaging.contract.ts). The feature is unusable
 * until three independent switches are on: the per-workspace flag, app credentials, and an operator's confirmation of the contract.
 */
@Injectable()
export class TikTokMessagingService {
  private readonly logger = new Logger(TikTokMessagingService.name);
  private readonly http: typeof fetch = (input, init) => fetch(input, init);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private audit: AuditService,
    private flags: FeatureFlagsService,
    private encryption: CredentialsEncryptionService,
    private storage: StorageService,
    private contacts: ContactsService,
    @Inject(forwardRef(() => MessagesService)) private messages: MessagesService,
  ) {}

  // ─── gates and status ──────────────────────────────────────────────────────────────────────────

  private get appId() { return this.config.get<string>('TIKTOK_BUSINESS_APP_ID') ?? ''; }
  private get appSecret() { return this.config.get<string>('TIKTOK_BUSINESS_APP_SECRET') ?? ''; }
  contractConfirmed(): boolean { return this.config.get<string>('TIKTOK_MESSAGING_CONTRACT_CONFIRMED') === 'true'; }
  private echoDelayMs(): number { return process.env['NODE_ENV'] === 'test' ? 0 : 2000; }

  /** Why TikTok messaging is not usable yet, in the order a person would fix it. Empty = every gate is open (not proof that TikTok has approved the app). */
  async unmet(tenantId: string): Promise<string[]> {
    const out: string[] = [];
    if (!(await this.flags.isEnabled(TIKTOK_MESSAGING_FLAG, tenantId))) out.push('The tiktok_messaging feature flag is off for this workspace.');
    if (!this.appId || !this.appSecret) out.push('TIKTOK_BUSINESS_APP_ID / TIKTOK_BUSINESS_APP_SECRET are not set on the server (the TikTok for Business app).');
    if (!this.contractConfirmed()) out.push('The TikTok API contract has not been confirmed against the portal (TIKTOK_MESSAGING_CONTRACT_CONFIRMED).');
    return out;
  }

  private async assertUsable(tenantId: string) {
    const unmet = await this.unmet(tenantId);
    if (unmet.length > 0) throw new ForbiddenException(`TikTok messaging is not enabled. ${unmet[0]}`);
  }

  async status(tenantId: string) {
    const channels = await this.prisma.channel.findMany({ where: { tenantId, type: ChannelType.TIKTOK }, select: { id: true, name: true, isActive: true, credentials: true, metadata: true } });
    const accounts = channels.filter((c) => asRecord(c.credentials)['kind'] === CHANNEL_KIND)
      .map((c) => ({ channelId: c.id, name: c.name, isActive: c.isActive, needsReconnect: asRecord(asRecord(c.metadata)['tiktokMessagingAuth'])['status'] === 'REAUTH_REQUIRED' }));
    return {
      flagEnabled: await this.flags.isEnabled(TIKTOK_MESSAGING_FLAG, tenantId),
      unmet: await this.unmet(tenantId),
      accounts,
      webhookUrl: this.webhookUrl(),
      requirements: [...PROVIDER_REQUIREMENTS],
      unconfirmedContract: unconfirmedContractItems().map((i) => ({ key: i.key, provenance: i.provenance })),
      limits: { replyWindowHours: CONTRACT.replyWindowHours.value, maxTextChars: CONTRACT.maxTextChars.value, outboundTypes: CONTRACT.outboundTypes.value, imageMaxBytes: CONTRACT.imageMaxBytes.value },
    };
  }

  private webhookUrl() { return `${(this.config.get<string>('PUBLIC_URL') ?? '').replace(/\/+$/, '')}/api/v1/webhook/tiktok-messaging`; }

  // ─── connection ────────────────────────────────────────────────────────────────────────────────

  authorizeUrl(tenantId: string, userId: string): string {
    const secret = this.config.get<string>('OAUTH_STATE_SECRET') ?? this.config.get<string>('JWT_SECRET', 'insecure-dev-fallback');
    const state = signOAuthState({ tenantId, provider: 'tiktok-messaging', userId }, secret);
    const apiUrl = this.config.get<string>('API_URL', 'http://localhost:3001/api/v1');
    const url = new URL(CONTRACT.authorizePath.value, TIKTOK_BUSINESS_API_BASE);
    url.searchParams.set('app_id', this.appId);
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', `${apiUrl}/tiktok/messaging/callback`);
    return url.toString();
  }

  async completeAuthorization(tenantId: string, userId: string, authCode: string) {
    await this.assertUsable(tenantId);
    const r = await client.exchangeAuthCode(this.http, { appId: this.appId, secret: this.appSecret, authCode });
    if (!r.ok) {
      this.logger.warn(`TikTok messaging authorisation failed for tenant ${tenantId}: code ${r.code} http ${r.httpStatus} ${r.message}`.slice(0, 220));
      throw new BadRequestException(isAuthFailure(r) ? 'TikTok did not accept this authorisation. Start the connection again.' : 'TikTok could not complete the connection. Try again in a moment.');
    }
    const t = r.data;
    if (!t.businessId) throw new BadRequestException('TikTok did not say which business account this is, so it cannot be connected.');
    const externalId = `biz:${t.businessId}`;

    // One webhook URL serves every workspace, so an account may be connected to one workspace at a time.
    const elsewhere = await this.prisma.channel.findFirst({ where: { type: ChannelType.TIKTOK, externalId, isActive: true, NOT: { tenantId } }, select: { id: true } });
    if (elsewhere) throw new ConflictException('This TikTok account is already connected to another workspace.');

    const credentials = {
      kind: CHANNEL_KIND, businessId: t.businessId, scope: t.scope ?? '',
      accessToken: this.encryption.encrypt(t.accessToken), refreshToken: this.encryption.encrypt(t.refreshToken),
      tokenExpiresAt: t.accessExpiresAt, ...(t.refreshExpiresAt && { refreshExpiresAt: t.refreshExpiresAt }), externalId,
    };
    const existing = await this.prisma.channel.findFirst({ where: { tenantId, type: ChannelType.TIKTOK, externalId } });
    let channel;
    if (existing) {
      channel = await this.prisma.channel.update({ where: { id: existing.id }, data: { credentials: credentials as Prisma.InputJsonValue, isActive: true, metadata: {} } });
    } else {
      let name = 'TikTok messages';
      for (let n = 2; await this.prisma.channel.findFirst({ where: { tenantId, type: ChannelType.TIKTOK, name } }); n++) name = `TikTok messages ${n}`;
      channel = await this.prisma.channel.create({ data: { tenantId, type: ChannelType.TIKTOK, name, externalId, credentials: credentials as Prisma.InputJsonValue, metadata: {}, isActive: true } });
    }
    void this.audit.log({ tenantId, userId, action: existing ? 'UPDATE' : 'CREATE', resource: 'channel', resourceId: channel.id, metadata: { action: 'TIKTOK_MESSAGING_CONNECTED' } })
      .catch((e) => this.logger.warn(`Audit write failed: ${e instanceof Error ? e.name : 'error'}`));
    return channel;
  }

  /** App-level, platform operators only: point TikTok's DIRECT_MESSAGE events at this server. */
  async registerWebhook() {
    if (!this.appId || !this.appSecret) throw new BadRequestException('TIKTOK_BUSINESS_APP_ID / TIKTOK_BUSINESS_APP_SECRET are not set.');
    if (!this.contractConfirmed()) throw new ForbiddenException('Confirm the TikTok API contract first (TIKTOK_MESSAGING_CONTRACT_CONFIRMED).');
    const url = this.webhookUrl();
    if (!url.startsWith('https://')) throw new BadRequestException('TikTok needs a public HTTPS callback URL (set PUBLIC_URL).');
    const r = await client.setWebhook(this.http, { appId: this.appId, secret: this.appSecret, callbackUrl: url });
    if (!r.ok) throw new BadRequestException(`TikTok refused the webhook registration (code ${r.code}): ${r.message}`);
    const check = await client.getWebhook(this.http, { appId: this.appId, secret: this.appSecret });
    return { registered: true, confirmedByTikTok: check.ok && check.data.callbackUrl === url, callbackUrl: url };
  }

  // ─── tokens ────────────────────────────────────────────────────────────────────────────────────

  private async loadChannel(tenantId: string, channelId: string) {
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, tenantId, type: ChannelType.TIKTOK } });
    if (!channel || asRecord(channel.credentials)['kind'] !== CHANNEL_KIND) throw new BadRequestException('This conversation\'s TikTok account is not connected for messaging.');
    return channel;
  }

  private async markReauth(channelId: string, info: string) {
    const c = await this.prisma.channel.findUnique({ where: { id: channelId }, select: { metadata: true } });
    await this.prisma.channel.update({ where: { id: channelId }, data: { metadata: { ...asRecord(c?.metadata), tiktokMessagingAuth: { status: 'REAUTH_REQUIRED', at: new Date().toISOString(), info } } as Prisma.InputJsonValue } });
  }

  /** A usable access token, refreshing a rotating pair when it is about to expire. The write is compare-and-set on the stored refresh token. */
  private async accessToken(channel: { id: string; tenantId: string; isActive: boolean; credentials: Prisma.JsonValue; metadata: Prisma.JsonValue }): Promise<{ token: string; creds: MessagingCreds } | { error: string }> {
    const c = asRecord(channel.credentials);
    if (!channel.isActive) return { error: 'This TikTok account is disconnected.' };
    if (asRecord(asRecord(channel.metadata)['tiktokMessagingAuth'])['status'] === 'REAUTH_REQUIRED') return { error: 'TikTok needs this account to be reconnected.' };
    const stored = { accessToken: String(c['accessToken'] ?? ''), refreshToken: String(c['refreshToken'] ?? ''), businessId: String(c['businessId'] ?? ''), tokenExpiresAt: c['tokenExpiresAt'] as string | undefined, refreshExpiresAt: c['refreshExpiresAt'] as string | undefined };
    if (!stored.accessToken || !stored.businessId) return { error: 'TikTok needs this account to be reconnected.' };
    const exp = stored.tokenExpiresAt ? Date.parse(stored.tokenExpiresAt) : NaN;
    if (Number.isNaN(exp) || exp - Date.now() > REFRESH_SKEW_MS) {
      try { return { token: this.encryption.decrypt(stored.accessToken), creds: stored }; } catch { return { error: 'TikTok needs this account to be reconnected.' }; }
    }
    if (stored.refreshExpiresAt && Date.parse(stored.refreshExpiresAt) <= Date.now()) { await this.markReauth(channel.id, 'refresh_expired'); return { error: 'TikTok needs this account to be reconnected.' }; }
    let refreshToken: string;
    try { refreshToken = this.encryption.decrypt(stored.refreshToken); } catch { return { error: 'TikTok needs this account to be reconnected.' }; }
    const r = await client.refreshAccessToken(this.http, { appId: this.appId, secret: this.appSecret, refreshToken });
    if (!r.ok) {
      if (isAuthFailure(r)) { await this.markReauth(channel.id, `refresh_rejected_${r.code}`); return { error: 'TikTok needs this account to be reconnected.' }; }
      return { error: 'TikTok could not renew the connection just now. Try again in a moment.' };
    }
    const next = { ...c, accessToken: this.encryption.encrypt(r.data.accessToken), refreshToken: this.encryption.encrypt(r.data.refreshToken), tokenExpiresAt: r.data.accessExpiresAt, ...(r.data.refreshExpiresAt && { refreshExpiresAt: r.data.refreshExpiresAt }) };
    const wrote = await this.prisma.channel.updateMany({ where: { id: channel.id, credentials: { path: ['refreshToken'], equals: stored.refreshToken } }, data: { credentials: next as Prisma.InputJsonValue } });
    if (wrote.count === 0) {
      // Another request rotated the pair first: ours is superseded, so use what is stored now.
      const fresh = await this.prisma.channel.findUnique({ where: { id: channel.id } });
      return fresh ? this.accessToken(fresh) : { error: 'This TikTok account is disconnected.' };
    }
    return { token: r.data.accessToken, creds: { ...stored, tokenExpiresAt: r.data.accessExpiresAt } };
  }

  // ─── inbound webhook ───────────────────────────────────────────────────────────────────────────

  /** `rawBody` must be the exact bytes TikTok sent (the signature covers them). A bad signature is a 403 with no detail. */
  async handleWebhook(rawBody: Buffer | undefined, signatureHeader: string | undefined): Promise<WebhookOutcome> {
    if (!this.contractConfirmed() || !this.appSecret) throw new ForbiddenException();
    if (!verifyTikTokSignature(this.appSecret, signatureHeader, rawBody)) throw new ForbiddenException();
    let body: unknown;
    try { body = JSON.parse(rawBody!.toString('utf8')); } catch { return { status: 'ignored', reason: 'malformed' }; }
    const n = normaliseTikTokEvent(body);
    if (!n.ok) return { status: 'ignored', reason: n.reason };
    const ev = n.event;

    // The workspace comes from OUR record of the account that received the event, never from the payload.
    const candidates = await this.prisma.channel.findMany({ where: { type: ChannelType.TIKTOK, externalId: `biz:${ev.businessId}`, isActive: true }, take: 2 });
    if (candidates.length === 0) return { status: 'ignored', reason: 'unknown-account' };
    if (candidates.length > 1) { this.logger.error(`TikTok account ${ev.businessId.slice(-4)} is connected to more than one workspace; event dropped`); return { status: 'ignored', reason: 'ambiguous-account' }; }
    const channel = candidates[0]!;
    if (!(await this.flags.isEnabledCached(TIKTOK_MESSAGING_FLAG, channel.tenantId).catch(() => false))) return { status: 'ignored', reason: 'disabled' };

    const key = tiktokMessageKey(ev.businessId, ev.messageId);
    if (await this.prisma.message.findFirst({ where: { tenantId: channel.tenantId, whatsappMessageId: key }, select: { id: true } })) return { status: 'duplicate' };

    if (ev.direction === 'OUTBOUND') {
      // Our own send is stored by the send path; give it a moment to record the id before treating this as a reply made elsewhere.
      if (this.echoDelayMs() > 0) await sleep(this.echoDelayMs());
      const r = await this.messages.handleMessengerEcho(channel.tenantId, channel.id, ev.userId, { mid: key, text: this.textFor(ev) }, ev.timestampMs, 'TIKTOK');
      return { status: r.status === 'stored' ? 'stored' : r.status === 'duplicate' || r.status === 'own-app' ? 'duplicate' : 'ignored' };
    }

    let prepared: { mediaUrl: string; mediaType: string; msgType: SharedMessageType } | undefined;
    let placeholder = ev.kind === 'text' ? undefined : this.textFor(ev);
    if (ev.kind === 'image' && ev.imageRef) {
      const tok = await this.accessToken(channel);
      const img = 'token' in tok ? await client.downloadImage(this.http, tok.token, { businessId: ev.businessId, mediaRef: ev.imageRef, messageId: ev.messageId }) : { ok: false as const, reason: 'no token' };
      if (img.ok) {
        const ext = img.mimeType === 'image/png' ? 'png' : 'jpg';
        const up = await this.storage.uploadRaw(img.buffer, img.mimeType, channel.tenantId, `tiktok-image.${ext}`);
        prepared = { mediaUrl: up.fileUrl, mediaType: img.mimeType, msgType: SharedMessageType.IMAGE };
        placeholder = undefined; // the stored image is the message; no "[Image]" label next to it
      } else {
        placeholder = '[Image could not be downloaded]';
        this.logger.warn(`TikTok image not stored for channel ${channel.id.slice(-6)} (${img.reason})`);
      }
    }
    const stored = await this.messages.handleInboundMessenger(
      channel.tenantId, channel.id, ev.userId,
      { mid: key, text: ev.kind === 'text' ? ev.text : undefined, displayText: placeholder, prepared },
      'TIKTOK',
    );
    return { status: (stored as { id?: string }).id ? 'stored' : 'ignored' };
  }

  private textFor(ev: TikTokInboundEvent): string | undefined {
    switch (ev.kind) {
      case 'text': return ev.text;
      case 'image': return '[Image]';
      case 'share_post': return ev.link ? `[Shared a TikTok post] ${ev.link}` : '[Shared a TikTok post]';
      case 'sticker': return '[Sticker]';
      default: return '[Sent a message type we can\'t display yet]';
    }
  }

  // ─── outbound ──────────────────────────────────────────────────────────────────────────────────

  private async withRetry<T>(op: () => Promise<client.ClientResult<T>>): Promise<client.ClientResult<T>> {
    let last = await op();
    // Only a clear "try again" from TikTok (429/5xx with an answer) is repeated. A lost answer is NOT: the message may already be delivered.
    for (const wait of [500, 1500]) {
      if (last.ok || !last.retryable || last.ambiguous) return last;
      if (process.env['NODE_ENV'] !== 'test') await sleep(wait);
      last = await op();
    }
    return last;
  }

  private async fail(channel: { id: string }, r: client.ClientFailure): Promise<never> {
    if (isAuthFailure(r)) await this.markReauth(channel.id, `send_rejected_${r.code}`).catch(() => undefined);
    if (r.ambiguous) throw new BadRequestException('TikTok did not confirm this message. It may or may not have been delivered. Check the conversation on TikTok before sending it again.');
    this.logger.warn(`TikTok send rejected for channel ${channel.id.slice(-6)}: code ${r.code} http ${r.httpStatus} ${r.message}`.slice(0, 220));
    throw new BadRequestException(describeSendFailure(r));
  }

  async sendText(tenantId: string, channelId: string, userId: string, text: string): Promise<string> {
    await this.assertUsable(tenantId);
    const bad = validateOutboundText(text);
    if (bad) throw new BadRequestException(bad);
    const channel = await this.loadChannel(tenantId, channelId);
    const tok = await this.accessToken(channel);
    if ('error' in tok) throw new BadRequestException(tok.error);
    const r = await this.withRetry(() => client.sendText(this.http, tok.token, { businessId: tok.creds.businessId, userId, text }));
    if (!r.ok) return this.fail(channel, r);
    return tiktokMessageKey(tok.creds.businessId, r.data.messageId);
  }

  /** One image per message; a caption is sent as its own text message because TikTok rejects text and image combined. */
  async sendImage(tenantId: string, channelId: string, userId: string, file: { buffer: Buffer; mimeType: string }, caption?: string): Promise<string> {
    await this.assertUsable(tenantId);
    const bad = validateOutboundImage(file.mimeType, file.buffer.length);
    if (bad) throw new BadRequestException(bad);
    const channel = await this.loadChannel(tenantId, channelId);
    const tok = await this.accessToken(channel);
    if ('error' in tok) throw new BadRequestException(tok.error);
    const up = await this.withRetry(() => client.uploadImage(this.http, tok.token, { businessId: tok.creds.businessId, buffer: file.buffer, mimeType: file.mimeType.split(';')[0]!.trim() }));
    if (!up.ok) return this.fail(channel, up);
    const sent = await this.withRetry(() => client.sendImage(this.http, tok.token, { businessId: tok.creds.businessId, userId, mediaId: up.data.mediaId }));
    if (!sent.ok) return this.fail(channel, sent);
    const key = tiktokMessageKey(tok.creds.businessId, sent.data.messageId);
    if (caption?.trim()) {
      await this.sendText(tenantId, channelId, userId, caption.slice(0, CONTRACT.maxTextChars.value))
        .catch((e) => this.logger.warn(`TikTok image caption not sent: ${e instanceof Error ? e.message : 'error'}`));
    }
    return key;
  }

  // ─── history ───────────────────────────────────────────────────────────────────────────────────

  /**
   * Imports earlier conversations silently (no alerts, no unread, no AI), idempotent by provider message id, bounded in size. Restarts from the newest
   * conversation each run; skipDuplicates makes a repeat harmless. No checkpoint table: this is an on-demand backfill, not a continuous sync.
   */
  async importHistory(tenantId: string, userId: string, channelId: string) {
    await this.assertUsable(tenantId);
    const channel = await this.loadChannel(tenantId, channelId);
    const tok = await this.accessToken(channel);
    if ('error' in tok) throw new BadRequestException(tok.error);
    const businessId = tok.creds.businessId;
    const report = { conversations: 0, messagesImported: 0, messagesSkipped: 0, unreadable: 0, truncated: false, error: undefined as string | undefined };

    let cursor: string | undefined;
    outer: for (;;) {
      const page = await this.withRetry(() => client.listConversations(this.http, tok.token, { businessId, cursor }));
      if (!page.ok) { report.error = isAuthFailure(page) ? 'TikTok needs this account to be reconnected.' : 'TikTok could not list conversations.'; break; }
      for (const conv of page.data.items) {
        if (report.conversations >= MAX_HISTORY_CONVERSATIONS) { report.truncated = true; break outer; }
        report.conversations++;
        let mCursor: string | undefined; let fetched = 0; let contactId: string | undefined; let conversationId: string | undefined;
        for (;;) {
          const msgs = await this.withRetry(() => client.listMessages(this.http, tok.token, { businessId, conversationId: conv.id, cursor: mCursor }));
          if (!msgs.ok) { report.error = 'TikTok could not list some messages.'; break; }
          fetched += msgs.data.items.length;
          const rows: Prisma.MessageCreateManyInput[] = [];
          for (const raw of msgs.data.items) {
            const n = normaliseTikTokEvent({ event: CONTRACT.eventNames.value.message, user_openid: businessId, content: raw });
            if (!n.ok) { report.unreadable++; continue; }
            const ev = n.event;
            if (!contactId) {
              contactId = (await this.contacts.findOrCreateByExternalId(tenantId, 'TIKTOK_USER_ID', ev.userId)).id;
              conversationId = await this.ensureConversation(tenantId, channel.id, contactId);
            }
            const at = ev.timestampMs ? new Date(ev.timestampMs) : new Date();
            const outbound = ev.direction === 'OUTBOUND';
            rows.push({
              tenantId, conversationId: conversationId!, contactId, channelId: channel.id, whatsappMessageId: tiktokMessageKey(businessId, ev.messageId),
              direction: outbound ? MessageDirection.OUTBOUND : MessageDirection.INBOUND, status: outbound ? MessageStatus.SENT : MessageStatus.DELIVERED,
              type: MessageType.TEXT, content: this.textFor(ev) ?? '[Message type not available from TikTok history]', createdAt: at, sentAt: at,
              metadata: { imported: true, source: 'tiktok_history' },
            });
          }
          if (rows.length > 0) {
            const res = await this.prisma.message.createMany({ data: rows, skipDuplicates: true });
            report.messagesImported += res.count; report.messagesSkipped += rows.length - res.count;
            const newest = rows.reduce((a, r) => ((r.createdAt as Date) > a ? (r.createdAt as Date) : a), rows[0]!.createdAt as Date);
            await this.prisma.conversation.updateMany({ where: { id: conversationId, tenantId, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: newest } }] }, data: { lastMessageAt: newest } });
          }
          if (!msgs.data.cursor || fetched >= MAX_HISTORY_MESSAGES) break;
          mCursor = msgs.data.cursor;
        }
      }
      if (!page.data.cursor) break;
      cursor = page.data.cursor;
    }
    void this.audit.log({ tenantId, userId, action: 'UPDATE', resource: 'channel', resourceId: channel.id, metadata: { action: 'TIKTOK_HISTORY_IMPORTED', conversations: report.conversations, messagesImported: report.messagesImported } })
      .catch(() => undefined);
    return report;
  }

  private async ensureConversation(tenantId: string, channelId: string, contactId: string): Promise<string> {
    const existing = await this.prisma.conversation.findFirst({ where: { tenantId, contactId, OR: [{ channelId }, { channelId: null }] }, orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], select: { id: true, channelId: true } });
    if (existing) { if (!existing.channelId) await this.prisma.conversation.update({ where: { id: existing.id }, data: { channelId } }); return existing.id; }
    return (await this.prisma.conversation.create({ data: { tenantId, contactId, channelId, status: ConversationStatus.OPEN, unreadCount: 0 }, select: { id: true } })).id;
  }
}
