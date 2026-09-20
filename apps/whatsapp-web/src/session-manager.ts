import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as QRCode from 'qrcode';
import makeWASocket, {
  DisconnectReason,
  Browsers,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { randomUUID } from 'crypto';
import { PostgresAuthStateStore } from './auth-state-store';

const BACKEND_INTERNAL_URL = process.env['BACKEND_INTERNAL_URL'] ?? 'http://backend:3001';
const INTERNAL_API_KEY = process.env['WHATSAPP_WEB_INTERNAL_API_KEY'] ?? '';

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'warn' });

// Bounded exponential backoff for reconnect attempts -- the brief explicitly
// requires no infinite reconnect loop consuming CPU/memory.
const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 5 * 60_000;
const RECONNECT_MAX_ATTEMPTS = 10;

// Identifies this process for the session-ownership lease below -- unique
// per container/restart, not persisted anywhere else.
const INSTANCE_ID = randomUUID();
const LEASE_HEARTBEAT_INTERVAL_MS = 15_000;
// Comfortably more than one missed heartbeat before a lease is considered
// abandoned and reclaimable -- avoids a transient slow tick causing a false
// takeover while the original holder is still alive and well.
const LEASE_STALE_MS = 45_000;

interface ActiveSession {
  sock: WASocket;
  authStore: PostgresAuthStateStore;
  reconnectAttempts: number;
  // False until the very first successful 'open' -- distinguishes "this QR
  // was never scanned before the connection died" (QR_EXPIRED, no point
  // auto-retrying without a fresh QR) from "was connected, then dropped"
  // (RECONNECTING, worth retrying with backoff).
  hasConnectedOnce: boolean;
  heartbeatTimer: NodeJS.Timeout;
}

export class SessionManager {
  private readonly active = new Map<string, ActiveSession>();

  constructor(private readonly prisma: PrismaClient) {}

  /** On process startup: reconnect every session that was CONNECTED before the last shutdown, so a restart doesn't force re-scanning every QR. */
  async restoreConnectedSessions(): Promise<void> {
    const sessions = await this.prisma.whatsAppWebSession.findMany({
      where: { status: { in: ['CONNECTED', 'RECONNECTING'] } },
    });
    for (const session of sessions) {
      logger.info({ sessionId: session.id }, 'restoring WhatsApp Web session on startup');
      await this.connect(session.id, session.tenantId, session.channelId).catch((err) => {
        logger.error({ sessionId: session.id, err }, 'failed to restore session on startup');
      });
    }
  }

  isActive(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  /**
   * Atomically claims (or renews) this session's single-owner lease. Only
   * succeeds if nobody holds it, this instance already does, or the current
   * holder's lease has gone stale -- so if this service is ever scaled to
   * more than one replica, at most one instance can ever hold a live
   * Baileys socket for a given session at a time.
   */
  private async claimLease(sessionId: string): Promise<boolean> {
    const result = await this.prisma.whatsAppWebSession.updateMany({
      where: {
        id: sessionId,
        OR: [
          { ownerInstanceId: null },
          { ownerInstanceId: INSTANCE_ID },
          { lockHeartbeatAt: { lt: new Date(Date.now() - LEASE_STALE_MS) } },
        ],
      },
      data: { ownerInstanceId: INSTANCE_ID, lockHeartbeatAt: new Date() },
    });
    return result.count > 0;
  }

  /** Releases the lease immediately (rather than waiting for it to go stale) -- used on logout/permanent failure/graceful shutdown so another instance (or this one, on restart) doesn't sit idle for LEASE_STALE_MS. */
  private async releaseLease(sessionId: string): Promise<void> {
    await this.prisma.whatsAppWebSession.updateMany({
      where: { id: sessionId, ownerInstanceId: INSTANCE_ID },
      data: { ownerInstanceId: null, lockHeartbeatAt: null },
    }).catch((err) => {
      logger.warn({ sessionId, err }, 'failed to release WhatsApp Web session lease');
    });
  }

  /** Releases every lease this instance currently holds -- called on graceful shutdown so a redeploy doesn't strand sessions for LEASE_STALE_MS before they're reclaimed. */
  async releaseAllLeases(): Promise<void> {
    await Promise.all([...this.active.keys()].map((sessionId) => this.releaseLease(sessionId)));
  }

  /** Starts (or restarts) a Baileys socket for this session. Emits QR/status events to backend as they happen. */
  async connect(sessionId: string, tenantId: string, channelId: string): Promise<void> {
    if (this.active.has(sessionId)) return;

    if (!(await this.claimLease(sessionId))) {
      logger.warn({ sessionId }, 'could not claim WhatsApp Web session lease -- another instance already holds it');
      return;
    }

    const authStore = await PostgresAuthStateStore.load(this.prisma, sessionId);

    // WhatsApp's servers reject the noise handshake outright for a stale
    // protocol version, failing every connection attempt with a generic
    // "Connection Failure" during frame decoding -- confirmed live on
    // staging (the very first real Baileys connection this codebase ever
    // attempted; dev/CI can't reach WhatsApp's servers to catch this).
    // Fetching the current version at connect time, with the library's
    // baked-in default as a fallback if the version-check call itself
    // fails, avoids pinning to whatever version shipped with this Baileys
    // release.
    let version: [number, number, number] | undefined;
    try {
      version = (await fetchLatestBaileysVersion()).version;
    } catch (err) {
      logger.warn({ sessionId, err }, 'failed to fetch latest WhatsApp Web version -- falling back to library default');
    }

    const sock = makeWASocket({
      auth: authStore.authState,
      logger: logger.child({ sessionId }),
      browser: Browsers.macOS('Verz'),
      printQRInTerminal: false,
      syncFullHistory: false,
      ...(version ? { version } : {}),
    });

    const heartbeatTimer = setInterval(() => {
      void this.claimLease(sessionId).then((held) => {
        if (!held) {
          // Lost the lease (shouldn't normally happen while actively
          // heartbeating, but a long GC pause or DB hiccup could let it go
          // stale) -- another instance may now own this session, so back
          // off rather than keep running a socket we no longer have a
          // lease for.
          logger.warn({ sessionId }, 'lost WhatsApp Web session lease during heartbeat -- tearing down local socket');
          const current = this.active.get(sessionId);
          if (current) {
            clearInterval(current.heartbeatTimer);
            this.active.delete(sessionId);
            current.sock.end(undefined);
          }
        }
      }).catch((err) => logger.warn({ sessionId, err }, 'WhatsApp Web session lease heartbeat failed'));
    }, LEASE_HEARTBEAT_INTERVAL_MS);

    const entry: ActiveSession = { sock, authStore, reconnectAttempts: 0, hasConnectedOnce: false, heartbeatTimer };
    this.active.set(sessionId, entry);

    sock.ev.on('creds.update', () => { void authStore.saveCreds(); });

    sock.ev.on('connection.update', (update) => {
      void this.handleConnectionUpdate(sessionId, tenantId, channelId, entry, update);
    });

    sock.ev.on('messages.upsert', (upsert) => {
      if (upsert.type !== 'notify') return;
      for (const msg of upsert.messages) {
        void this.handleInboundMessage(tenantId, channelId, sessionId, msg);
      }
    });
  }

  private async handleConnectionUpdate(
    sessionId: string,
    tenantId: string,
    channelId: string,
    entry: ActiveSession,
    update: { qr?: string; connection?: string; lastDisconnect?: { error?: unknown } },
  ): Promise<void> {
    if (update.qr) {
      const qrDataUrl = await QRCode.toDataURL(update.qr);
      await this.prisma.whatsAppWebSession.update({
        where: { id: sessionId },
        data: { status: 'QR_PENDING' },
      }).catch(() => {});
      await this.notifyBackend({ type: 'qr', tenantId, sessionId, channelId, qrDataUrl });
      return;
    }

    if (update.connection === 'open') {
      entry.reconnectAttempts = 0;
      entry.hasConnectedOnce = true;
      const phoneNumber = entry.sock.user?.id?.split(':')[0]?.split('@')[0];
      await this.prisma.whatsAppWebSession.update({
        where: { id: sessionId },
        data: { status: 'CONNECTED', phoneNumber, lastConnectedAt: new Date(), lastSeenAt: new Date(), lastError: null, lastErrorAt: null },
      }).catch(() => {});
      await entry.authStore.flush();
      await this.notifyBackend({ type: 'status', tenantId, sessionId, channelId, status: 'CONNECTED', phoneNumber });
      return;
    }

    if (update.connection === 'close') {
      const boom = update.lastDisconnect?.error as Boom | undefined;
      const statusCode = boom?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      clearInterval(entry.heartbeatTimer);
      this.active.delete(sessionId);

      if (loggedOut) {
        await this.prisma.whatsAppWebSession.update({
          where: { id: sessionId },
          data: { status: 'LOGGED_OUT', encryptedAuthState: null, lastError: 'Logged out from the linked device', lastErrorAt: new Date(), ownerInstanceId: null, lockHeartbeatAt: null },
        }).catch(() => {});
        await this.notifyBackend({ type: 'status', tenantId, sessionId, channelId, status: 'LOGGED_OUT' });
        return;
      }

      // The QR was never scanned before Baileys gave up refreshing it and
      // closed the connection -- terminal until the user explicitly starts a
      // fresh pairing attempt, not something worth the reconnect backoff
      // below (nothing to reconnect to; auth never completed).
      if (!entry.hasConnectedOnce) {
        await this.prisma.whatsAppWebSession.update({
          where: { id: sessionId },
          data: { status: 'QR_EXPIRED', lastError: 'QR code expired before it was scanned', lastErrorAt: new Date(), ownerInstanceId: null, lockHeartbeatAt: null },
        }).catch(() => {});
        await this.notifyBackend({ type: 'status', tenantId, sessionId, channelId, status: 'QR_EXPIRED' });
        return;
      }

      if (entry.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
        await this.prisma.whatsAppWebSession.update({
          where: { id: sessionId },
          data: { status: 'ERROR', lastError: 'Exceeded max reconnect attempts', lastErrorAt: new Date(), ownerInstanceId: null, lockHeartbeatAt: null },
        }).catch(() => {});
        await this.notifyBackend({ type: 'status', tenantId, sessionId, channelId, status: 'ERROR' });
        return;
      }

      const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** entry.reconnectAttempts, RECONNECT_MAX_DELAY_MS);
      await this.prisma.whatsAppWebSession.update({
        where: { id: sessionId },
        data: { status: 'RECONNECTING', lastError: boom?.message ?? 'Connection closed', lastErrorAt: new Date() },
      }).catch(() => {});
      await this.notifyBackend({ type: 'status', tenantId, sessionId, channelId, status: 'RECONNECTING' });

      setTimeout(() => {
        void this.connect(sessionId, tenantId, channelId).then(() => {
          const restored = this.active.get(sessionId);
          if (restored) restored.reconnectAttempts = entry.reconnectAttempts + 1;
        });
      }, delay);
    }
  }

  private async handleInboundMessage(tenantId: string, channelId: string, sessionId: string, msg: WAMessage): Promise<void> {
    // Echoes of our own outgoing messages, and messages with no actual
    // content (protocol/system messages), aren't real inbound customer
    // messages -- mirrors the Messenger channel's is_echo exclusion.
    if (msg.key.fromMe) return;
    if (!msg.message) return;

    const fromPhone = msg.key.remoteJid?.split('@')[0];
    if (!fromPhone) return;

    // Media/text parsing lives here (not in the backend) -- this is the one
    // place that actually understands Baileys' payload shape, mirroring how
    // WhatsApp Cloud's own payload parsing stays inside its own service.
    const m = msg.message;
    const content = m.conversation ?? m.extendedTextMessage?.text ?? undefined;

    let mediaType: 'image' | 'video' | 'audio' | 'document' | undefined;
    let caption: string | undefined;
    let mimetype: string | undefined;
    if (m.imageMessage) { mediaType = 'image'; caption = m.imageMessage.caption ?? undefined; mimetype = m.imageMessage.mimetype ?? undefined; }
    else if (m.videoMessage) { mediaType = 'video'; caption = m.videoMessage.caption ?? undefined; mimetype = m.videoMessage.mimetype ?? undefined; }
    else if (m.audioMessage) { mediaType = 'audio'; mimetype = m.audioMessage.mimetype ?? undefined; }
    else if (m.documentMessage) { mediaType = 'document'; caption = m.documentMessage.caption ?? undefined; mimetype = m.documentMessage.mimetype ?? undefined; }

    let mediaBase64: string | undefined;
    const entry = this.active.get(sessionId);
    if (mediaType && entry) {
      try {
        const buffer = await downloadMediaMessage(
          msg,
          'buffer',
          {},
          { logger: logger.child({ sessionId }), reuploadRequest: entry.sock.updateMediaMessage },
        );
        mediaBase64 = Buffer.isBuffer(buffer) ? buffer.toString('base64') : undefined;
      } catch (err) {
        logger.error({ err, sessionId }, 'failed to download inbound WhatsApp Web media -- delivering as text-only fallback');
      }
    }

    await this.notifyBackend({
      type: 'inbound_message',
      tenantId,
      channelId,
      fromPhone,
      providerMessageId: msg.key.id,
      timestamp: typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : Date.now(),
      content,
      mediaType,
      mediaBase64,
      mimetype,
      caption,
      pushName: msg.pushName ?? undefined,
    });
  }

  async sendText(sessionId: string, toPhone: string, text: string): Promise<string> {
    const entry = this.active.get(sessionId);
    if (!entry) throw new Error('This WhatsApp Web session is not currently connected.');
    const jid = `${toPhone.replace(/[^\d]/g, '')}@s.whatsapp.net`;
    const result = await entry.sock.sendMessage(jid, { text });
    return result?.key.id ?? '';
  }

  async sendMedia(sessionId: string, toPhone: string, mediaUrl: string, mediaType: 'image' | 'video' | 'audio' | 'document', caption?: string): Promise<string> {
    const entry = this.active.get(sessionId);
    if (!entry) throw new Error('This WhatsApp Web session is not currently connected.');
    const jid = `${toPhone.replace(/[^\d]/g, '')}@s.whatsapp.net`;
    const { data } = await axios.get<ArrayBuffer>(mediaUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(data);
    const payload = mediaType === 'document'
      ? { document: buffer, caption, mimetype: 'application/octet-stream' }
      : { [mediaType]: buffer, caption };
    const result = await entry.sock.sendMessage(jid, payload as Parameters<WASocket['sendMessage']>[1]);
    return result?.key.id ?? '';
  }

  async disconnect(sessionId: string): Promise<void> {
    const entry = this.active.get(sessionId);
    if (entry) {
      clearInterval(entry.heartbeatTimer);
      await entry.authStore.flush();
      entry.sock.end(undefined);
      this.active.delete(sessionId);
      // Deliberately keeps the lease held (not released) -- this is a
      // resumable disconnect (backend marks it RECONNECTING, expecting to
      // reconnect without a fresh QR scan later), so this instance should
      // stay the owner rather than let another instance race to claim it
      // the moment it goes stale.
    }
  }

  async logout(sessionId: string): Promise<void> {
    const entry = this.active.get(sessionId);
    if (entry) {
      clearInterval(entry.heartbeatTimer);
      await entry.sock.logout().catch(() => {});
      this.active.delete(sessionId);
      // sock.logout() triggers Baileys' own 'close' event (loggedOut reason),
      // which releases the lease via handleConnectionUpdate -- no need to
      // duplicate that here.
    }
  }

  /** Flush every active session's auth state -- called before process shutdown. */
  async flushAll(): Promise<void> {
    await Promise.all([...this.active.values()].map((e) => e.authStore.flush()));
  }

  private async notifyBackend(payload: Record<string, unknown>): Promise<void> {
    // The backend applies a global 'api/v1' prefix to every route (see
    // apps/backend/src/main.ts's app.setGlobalPrefix('api/v1')) -- this
    // internal controller is no exception, so the real registered path is
    // /api/v1/internal/whatsapp-web/events, not the bare path this called
    // until now. Confirmed live: every event notification was silently
    // failing with a 404 ("Cannot POST /internal/whatsapp-web/events"),
    // since nothing in dev/CI ever exercised a real Baileys connection to
    // trigger this call for real.
    await axios.post(`${BACKEND_INTERNAL_URL}/api/v1/internal/whatsapp-web/events`, payload, {
      headers: { 'x-internal-api-key': INTERNAL_API_KEY },
      timeout: 10_000,
    }).catch((err) => {
      logger.error({ err, payloadType: payload['type'] }, 'failed to notify backend of whatsapp-web event');
    });
  }
}
