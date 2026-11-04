import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ChannelHistorySync, ChannelHistorySyncStatus, ChannelType, ConversationStatus, MessageDirection, MessageStatus, MessageType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialsEncryptionService } from '../common/crypto/credentials-encryption.service';
import { ContactsService } from '../contacts/contacts.service';

/**
 * Imports a connected Page's EXISTING Messenger conversations. Webhooks only ever deliver new events, so before this a freshly connected Page
 * showed an empty inbox until somebody wrote again.
 *
 * Source: Graph API Conversations API (`/me/conversations`, `/{conversation-id}/messages`) with the Page access token and the `pages_messaging`
 * permission the connection already requests. What Meta does not return is not invented: attachments are recorded as a labelled placeholder
 * (Meta's attachment URLs are short lived), and only what the API pages back (Meta limits how far back and how many messages it serves) is imported.
 *
 * Guarantees: idempotent (stable `mid` + unique [tenantId, whatsappMessageId], inserts skip duplicates, so webhook and import can overlap and a reconnect
 * cannot duplicate); never overwrites existing rows; only moves a conversation's lastMessageAt forward; no unread increments, realtime events, SLA
 * requests or AI triggers (history is not "new"); resumable (cursor checkpoint) and incremental (watermark); everything scoped to the tenant and channel.
 * Logs carry ids, counts and Meta error codes only: never message text, names, tokens or the Page id in full.
 */

const GRAPH = 'https://graph.facebook.com/v19.0';
const CONV_PAGE = 25;
const MSG_PAGE = 25;
const MAX_CONVERSATIONS = 2000;
const MAX_MESSAGES_PER_CONVERSATION = 5000;
const STALE_HEARTBEAT_MS = 5 * 60_000;
const MAX_RETRIES = 3;
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80006]);
const AUTH_CODES = new Set([102, 190, 458, 459, 460, 463, 467]);
const PERMISSION_CODES = new Set([10, 200, 299]);

export class MetaGraphError extends Error {
  constructor(readonly kind: 'rate_limit' | 'auth' | 'permission' | 'transient' | 'other', readonly code: number | null, readonly httpStatus: number, message: string) {
    super(message);
  }
}

interface GraphConversation { id: string; updated_time?: string; participants?: { data?: Array<{ id?: string; name?: string }> } }
interface GraphMessage {
  id: string; created_time?: string; from?: { id?: string; name?: string }; message?: string;
  attachments?: { data?: Array<{ mime_type?: string; name?: string }> }; sticker?: string;
}
interface GraphPage<T> { data?: T[]; paging?: { cursors?: { after?: string }; next?: string }; error?: { code?: number; error_subcode?: number; message?: string } }

export interface HistorySyncStatusView {
  status: ChannelHistorySyncStatus | 'NOT_STARTED';
  startedAt: Date | null; finishedAt: Date | null;
  conversations: { discovered: number; imported: number; skipped: number; failed: number };
  messages: { discovered: number; imported: number; skipped: number };
  lastErrorCode: number | null; lastError: string | null;
  resumable: boolean;
}

const sanitise = (v: unknown, max = 160) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').replace(/(access_token|token|secret)=\S+/gi, '$1=[redacted]').slice(0, max) : '');
const tail4 = (v: string) => `…${v.slice(-4)}`;

@Injectable()
export class MessengerHistorySyncService {
  private readonly logger = new Logger(MessengerHistorySyncService.name);
  /** Overridable in tests so retry backoff does not sleep. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Runs started by this process; lets tests await completion. */
  readonly running = new Map<string, Promise<void>>();

  constructor(
    private prisma: PrismaService,
    private encryption: CredentialsEncryptionService,
    private contacts: ContactsService,
  ) {}

  // ─── public API ────────────────────────────────────────────────────────────────────────────────────

  async getStatus(tenantId: string, channelId: string): Promise<HistorySyncStatusView> {
    await this.requireChannel(tenantId, channelId);
    const row = await this.prisma.channelHistorySync.findUnique({ where: { channelId } });
    if (!row || row.tenantId !== tenantId) {
      return { status: 'NOT_STARTED', startedAt: null, finishedAt: null, conversations: { discovered: 0, imported: 0, skipped: 0, failed: 0 }, messages: { discovered: 0, imported: 0, skipped: 0 }, lastErrorCode: null, lastError: null, resumable: false };
    }
    return this.view(row);
  }

  /** Starts (or resumes) an import in the background and returns immediately. A run that is already active is not duplicated. */
  async start(tenantId: string, channelId: string): Promise<HistorySyncStatusView> {
    const channel = await this.requireChannel(tenantId, channelId);
    const connection = await this.prisma.facebookPageConnection.findFirst({ where: { tenantId, channelId } });
    if (!connection || !connection.isActive) throw new BadRequestException('This Facebook Page is not connected. Reconnect it in Channels first.');

    const existing = await this.prisma.channelHistorySync.findUnique({ where: { channelId } });
    const active = existing?.status === ChannelHistorySyncStatus.SYNCING && existing.heartbeatAt && Date.now() - existing.heartbeatAt.getTime() < STALE_HEARTBEAT_MS;
    if (existing && active) return this.view(existing);

    const correlationId = randomUUID();
    // A stale SYNCING row (process died) or PARTIAL/FAILED row resumes from its cursor; COMPLETED/new starts from the top but stays incremental via the watermark.
    const resuming = !!existing && existing.status !== ChannelHistorySyncStatus.COMPLETED && !!existing.cursor;
    const row = await this.prisma.channelHistorySync.upsert({
      where: { channelId },
      create: { tenantId, channelId, status: ChannelHistorySyncStatus.SYNCING, correlationId, attempts: 1, startedAt: new Date(), heartbeatAt: new Date() },
      update: {
        status: ChannelHistorySyncStatus.SYNCING, correlationId, attempts: { increment: 1 }, startedAt: new Date(), finishedAt: null, heartbeatAt: new Date(), lastError: null, lastErrorCode: null,
        ...(resuming ? {} : { cursor: null, pendingWatermark: null, conversationsDiscovered: 0, conversationsImported: 0, conversationsSkipped: 0, conversationsFailed: 0, messagesDiscovered: 0, messagesImported: 0, messagesSkipped: 0 }),
      },
    });
    this.logger.log(this.line('sync_started', row, { resuming, hasWatermark: !!row.watermark, page: tail4(connection.pageId) }));

    const run = this.run(row, connection.pageId, channel.id)
      .catch((e) => this.logger.error(this.line('sync_crashed', row, { error: sanitise(e instanceof Error ? e.message : String(e)) })))
      .finally(() => this.running.delete(channelId));
    this.running.set(channelId, run);
    return this.view(row);
  }

  // ─── the run ───────────────────────────────────────────────────────────────────────────────────────

  private async run(initial: ChannelHistorySync, pageId: string, channelId: string): Promise<void> {
    const { tenantId } = initial;
    const connection = await this.prisma.facebookPageConnection.findFirst({ where: { tenantId, channelId } });
    if (!connection) return this.finish(initial, ChannelHistorySyncStatus.FAILED, { error: 'Page connection missing' });
    const token = this.encryption.decrypt(connection.pageAccessToken);

    const state = { ...initial };
    let after: string | undefined = initial.cursor ?? undefined;
    let pendingWatermark: Date | null = initial.pendingWatermark;
    const watermark = initial.watermark;
    let pages = 0;
    let reachedWatermark = false;

    try {
      while (true) {
        const params: Record<string, string> = { fields: 'id,updated_time,participants', limit: String(CONV_PAGE) };
        if (after) params['after'] = after;
        const page = await this.graph<GraphConversation>('me/conversations', params, token);
        pages += 1;
        const conversations = page.data ?? [];
        this.logger.log(this.line('conversations_page', state, { page: pages, count: conversations.length, hasNext: !!page.paging?.next }));

        for (const conv of conversations) {
          if (state.conversationsDiscovered >= MAX_CONVERSATIONS) { reachedWatermark = true; break; }
          const updated = conv.updated_time ? new Date(conv.updated_time) : null;
          if (updated && (!pendingWatermark || updated > pendingWatermark)) pendingWatermark = updated;
          if (watermark && updated && updated <= watermark) { reachedWatermark = true; break; } // newest first: everything after this was imported by an earlier completed run
          state.conversationsDiscovered += 1;
          try {
            const r = await this.importConversation(tenantId, channelId, pageId, conv, token, state, !!watermark);
            if (r === 'skipped') state.conversationsSkipped += 1; else state.conversationsImported += 1;
          } catch (e) {
            if (e instanceof MetaGraphError) throw e; // rate limit / auth / permission end the run (checkpointed below)
            state.conversationsFailed += 1;
            this.logger.warn(this.line('conversation_failed', state, { conversation: tail4(conv.id), error: sanitise(e instanceof Error ? e.message : String(e)) }));
          }
        }
        const next = page.paging?.next ? page.paging.cursors?.after : undefined;
        await this.checkpoint(state, { cursor: next ?? null, pendingWatermark });
        if (reachedWatermark || !next) break;
        after = next;
      }
      const clean = state.conversationsFailed === 0;
      await this.finish(state, clean ? ChannelHistorySyncStatus.COMPLETED : ChannelHistorySyncStatus.PARTIAL, {
        ...(clean && { watermark: pendingWatermark ?? watermark, cursor: null, pendingWatermark: null }),
        ...(clean ? {} : { error: `${state.conversationsFailed} conversation(s) could not be imported; run again to retry them` }),
      });
    } catch (e) {
      if (!(e instanceof MetaGraphError)) throw e;
      // keep the checkpoint so a retry resumes where this stopped
      const status = e.kind === 'rate_limit' || e.kind === 'transient' ? ChannelHistorySyncStatus.PARTIAL : ChannelHistorySyncStatus.FAILED;
      const message = e.kind === 'auth' ? 'Facebook access expired or was revoked. Reconnect the Page.'
        : e.kind === 'permission' ? 'Meta has not granted this app permission to read this Page\'s conversations.'
        : e.kind === 'rate_limit' ? 'Meta rate limit reached. The import paused and can be resumed.'
        : `Meta returned an error (${sanitise(e.message, 100)})`;
      await this.finish(state, status, { error: message, errorCode: e.code ?? undefined, cursor: after ?? state.cursor, pendingWatermark });
    }
  }

  /** returns 'skipped' when the conversation has no other participant */
  private async importConversation(
    tenantId: string, channelId: string, pageId: string, conv: GraphConversation, token: string, state: ChannelHistorySync, incremental: boolean,
  ): Promise<'imported' | 'skipped'> {
    const other = (conv.participants?.data ?? []).find((p) => p.id && p.id !== pageId);
    if (!other?.id) return 'skipped';

    const contact = await this.contacts.findOrCreateByExternalId(tenantId, 'MESSENGER_PSID', other.id, other.name);
    let conversationId: string | null = null;
    let newest: Date | null = null;
    let after: string | undefined;
    let fetched = 0;

    while (fetched < MAX_MESSAGES_PER_CONVERSATION) {
      const params: Record<string, string> = { fields: 'id,created_time,from,message,attachments{mime_type,name},sticker', limit: String(MSG_PAGE) };
      if (after) params['after'] = after;
      const page = await this.graph<GraphMessage>(`${encodeURIComponent(conv.id)}/messages`, params, token);
      const messages = (page.data ?? []).filter((m) => m.id);
      fetched += messages.length;
      state.messagesDiscovered += messages.length;

      if (messages.length > 0) {
        if (!conversationId) conversationId = await this.ensureConversation(tenantId, channelId, contact.id);
        const rows = messages.map((m) => this.toRow(tenantId, channelId, conversationId as string, contact.id, pageId, m));
        const res = await this.prisma.message.createMany({ data: rows, skipDuplicates: true });
        state.messagesImported += res.count;
        state.messagesSkipped += rows.length - res.count;
        for (const r of rows) if (!newest || (r.createdAt as Date) > newest) newest = r.createdAt as Date;
        // Incremental runs: a whole page of already-known messages means everything older is known too. The first full run never stops early.
        if (incremental && res.count === 0) break;
      }
      const next = page.paging?.next ? page.paging.cursors?.after : undefined;
      if (!next) break;
      after = next;
    }

    if (conversationId && newest) {
      // forward only: never let imported (older) data overwrite a newer lastMessageAt set by a webhook
      await this.prisma.conversation.updateMany({
        where: { id: conversationId, tenantId, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: newest } }] },
        data: { lastMessageAt: newest },
      });
    }
    return 'imported';
  }

  private async ensureConversation(tenantId: string, channelId: string, contactId: string): Promise<string> {
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, contactId, OR: [{ channelId }, { channelId: null }] },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: { id: true, channelId: true },
    });
    if (existing) {
      if (!existing.channelId) await this.prisma.conversation.update({ where: { id: existing.id }, data: { channelId } });
      return existing.id;
    }
    // OPEN (not REQUESTED): visible in the default inbox without raising an SLA clock or notifying agents about every old thread.
    const created = await this.prisma.conversation.create({ data: { tenantId, contactId, channelId, status: ConversationStatus.OPEN, unreadCount: 0 }, select: { id: true } });
    return created.id;
  }

  private toRow(tenantId: string, channelId: string, conversationId: string, contactId: string, pageId: string, m: GraphMessage): Prisma.MessageCreateManyInput {
    const outbound = m.from?.id === pageId;
    const createdAt = m.created_time ? new Date(m.created_time) : new Date();
    const attachment = m.attachments?.data?.[0];
    let type: MessageType = MessageType.TEXT;
    let mediaType: string | undefined;
    let content = m.message?.trim() || '';
    if (attachment) {
      const mime = attachment.mime_type ?? '';
      type = mime.startsWith('image/') ? MessageType.IMAGE : mime.startsWith('video/') ? MessageType.VIDEO : mime.startsWith('audio/') ? MessageType.AUDIO : MessageType.DOCUMENT;
      mediaType = mime || undefined;
      if (!content) content = `[${type === MessageType.IMAGE ? 'Image' : type === MessageType.VIDEO ? 'Video' : type === MessageType.AUDIO ? 'Voice message' : 'File'} sent before this account was connected]`;
    } else if (m.sticker) {
      type = MessageType.STICKER;
      if (!content) content = '[Sticker]';
    }
    if (!content) content = '[Message type not available from Messenger history]';
    return {
      tenantId, conversationId, contactId, channelId, whatsappMessageId: m.id, createdAt, sentAt: createdAt,
      direction: outbound ? MessageDirection.OUTBOUND : MessageDirection.INBOUND,
      status: outbound ? MessageStatus.SENT : MessageStatus.DELIVERED,
      type, content, ...(mediaType && { mediaType }), metadata: { imported: true, source: 'messenger_history' },
    };
  }

  // ─── Graph with retry ──────────────────────────────────────────────────────────────────────────────

  private async graph<T>(path: string, params: Record<string, string>, token: string): Promise<GraphPage<T>> {
    let lastError: MetaGraphError | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await this.sleep(Math.min(30_000, 1000 * 2 ** (attempt - 1)));
      const url = new URL(`${GRAPH}/${path}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      url.searchParams.set('access_token', token);
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      } catch (e) {
        lastError = new MetaGraphError('transient', null, 0, e instanceof Error ? e.name : 'network error');
        continue;
      }
      let body: GraphPage<T> = {};
      try { body = (await res.json()) as GraphPage<T>; } catch { /* non-JSON body */ }
      if (res.ok && !body.error) return body;
      const code = body.error?.code ?? null;
      const msg = sanitise(body.error?.message) || `HTTP ${res.status}`;
      if (code !== null && AUTH_CODES.has(code)) throw new MetaGraphError('auth', code, res.status, msg);
      if (code !== null && PERMISSION_CODES.has(code)) throw new MetaGraphError('permission', code, res.status, msg);
      if (res.status === 429 || (code !== null && RATE_LIMIT_CODES.has(code))) { lastError = new MetaGraphError('rate_limit', code, res.status, msg); continue; }
      if (res.status >= 500) { lastError = new MetaGraphError('transient', code, res.status, msg); continue; }
      throw new MetaGraphError('other', code, res.status, msg);
    }
    throw lastError ?? new MetaGraphError('transient', null, 0, 'unknown');
  }

  // ─── persistence helpers ───────────────────────────────────────────────────────────────────────────

  private async requireChannel(tenantId: string, channelId: string) {
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, tenantId }, select: { id: true, type: true } });
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.type !== ChannelType.FACEBOOK_MESSENGER) throw new BadRequestException('History import is only available for Facebook Messenger channels.');
    return channel;
  }

  private async checkpoint(s: ChannelHistorySync, extra: { cursor: string | null; pendingWatermark: Date | null }) {
    await this.prisma.channelHistorySync.update({
      where: { channelId: s.channelId },
      data: {
        heartbeatAt: new Date(), cursor: extra.cursor, pendingWatermark: extra.pendingWatermark,
        conversationsDiscovered: s.conversationsDiscovered, conversationsImported: s.conversationsImported, conversationsSkipped: s.conversationsSkipped, conversationsFailed: s.conversationsFailed,
        messagesDiscovered: s.messagesDiscovered, messagesImported: s.messagesImported, messagesSkipped: s.messagesSkipped,
      },
    });
  }

  private async finish(s: ChannelHistorySync, status: ChannelHistorySyncStatus, o: { error?: string; errorCode?: number; watermark?: Date | null; cursor?: string | null; pendingWatermark?: Date | null }) {
    const data: Prisma.ChannelHistorySyncUpdateInput = {
      status, finishedAt: new Date(), heartbeatAt: new Date(),
      conversationsDiscovered: s.conversationsDiscovered, conversationsImported: s.conversationsImported, conversationsSkipped: s.conversationsSkipped, conversationsFailed: s.conversationsFailed,
      messagesDiscovered: s.messagesDiscovered, messagesImported: s.messagesImported, messagesSkipped: s.messagesSkipped,
      lastError: o.error ?? null, lastErrorCode: o.errorCode ?? null,
      ...(o.watermark !== undefined && { watermark: o.watermark }),
      ...(o.cursor !== undefined && { cursor: o.cursor }),
      ...(o.pendingWatermark !== undefined && { pendingWatermark: o.pendingWatermark }),
    };
    await this.prisma.channelHistorySync.update({ where: { channelId: s.channelId }, data });
    this.logger.log(this.line('sync_finished', s, {
      status, durationMs: s.startedAt ? Date.now() - s.startedAt.getTime() : null, errorCode: o.errorCode ?? null, error: o.error ?? null,
      conversations: { discovered: s.conversationsDiscovered, imported: s.conversationsImported, skipped: s.conversationsSkipped, failed: s.conversationsFailed },
      messages: { discovered: s.messagesDiscovered, imported: s.messagesImported, skipped: s.messagesSkipped },
    }));
  }

  private view(r: ChannelHistorySync): HistorySyncStatusView {
    return {
      status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt,
      conversations: { discovered: r.conversationsDiscovered, imported: r.conversationsImported, skipped: r.conversationsSkipped, failed: r.conversationsFailed },
      messages: { discovered: r.messagesDiscovered, imported: r.messagesImported, skipped: r.messagesSkipped },
      lastErrorCode: r.lastErrorCode, lastError: r.lastError,
      resumable: r.status !== ChannelHistorySyncStatus.COMPLETED && !!r.cursor,
    };
  }

  /** One structured log line: ids redacted to a suffix, counts and codes only. */
  private line(event: string, s: Pick<ChannelHistorySync, 'tenantId' | 'channelId' | 'correlationId'>, extra: Record<string, unknown>): string {
    return JSON.stringify({ event, correlationId: s.correlationId, tenant: tail4(s.tenantId), channel: tail4(s.channelId), ...extra });
  }
}
