import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as QRCode from 'qrcode';
import makeWASocket, {
  DisconnectReason,
  Browsers,
  downloadMediaMessage,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { PostgresAuthStateStore } from './auth-state-store';

const BACKEND_INTERNAL_URL = process.env['BACKEND_INTERNAL_URL'] ?? 'http://backend:3001';
const INTERNAL_API_KEY = process.env['WHATSAPP_WEB_INTERNAL_API_KEY'] ?? '';

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'warn' });

// Bounded exponential backoff for reconnect attempts -- the brief explicitly
// requires no infinite reconnect loop consuming CPU/memory.
const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 5 * 60_000;
const RECONNECT_MAX_ATTEMPTS = 10;

interface ActiveSession {
  sock: WASocket;
  authStore: PostgresAuthStateStore;
  reconnectAttempts: number;
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

  /** Starts (or restarts) a Baileys socket for this session. Emits QR/status events to backend as they happen. */
  async connect(sessionId: string, tenantId: string, channelId: string): Promise<void> {
    if (this.active.has(sessionId)) return;

    const authStore = await PostgresAuthStateStore.load(this.prisma, sessionId);
    const sock = makeWASocket({
      auth: authStore.authState,
      logger: logger.child({ sessionId }),
      browser: Browsers.macOS('Verz'),
      printQRInTerminal: false,
      syncFullHistory: false,
    });

    const entry: ActiveSession = { sock, authStore, reconnectAttempts: 0 };
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

      this.active.delete(sessionId);

      if (loggedOut) {
        await this.prisma.whatsAppWebSession.update({
          where: { id: sessionId },
          data: { status: 'LOGGED_OUT', encryptedAuthState: null, lastError: 'Logged out from the linked device', lastErrorAt: new Date() },
        }).catch(() => {});
        await this.notifyBackend({ type: 'status', tenantId, sessionId, channelId, status: 'LOGGED_OUT' });
        return;
      }

      if (entry.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
        await this.prisma.whatsAppWebSession.update({
          where: { id: sessionId },
          data: { status: 'ERROR', lastError: 'Exceeded max reconnect attempts', lastErrorAt: new Date() },
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
      await entry.authStore.flush();
      entry.sock.end(undefined);
      this.active.delete(sessionId);
    }
  }

  async logout(sessionId: string): Promise<void> {
    const entry = this.active.get(sessionId);
    if (entry) {
      await entry.sock.logout().catch(() => {});
      this.active.delete(sessionId);
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
