import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ChannelType } from '@prisma/client';
import { normalizePhone } from '@whatsapp-platform/shared-utils';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuditService } from '../audit/audit.service';
import { MessagesService } from '../messages/messages.service';
import { MessageStatus } from '@whatsapp-platform/shared-types';

interface WhatsAppWebEventPayload {
  type: 'qr' | 'status' | 'inbound_message' | 'message_status';
  tenantId: string;
  sessionId?: string;
  channelId: string;
  [key: string]: unknown;
}

/**
 * Unofficial WhatsApp Web / linked-device (QR) channel -- deliberately
 * separate from the official Cloud API (WhatsAppNumbersService). Talks to
 * the apps/whatsapp-web session-manager service over internal HTTP for
 * everything that touches a live Baileys socket (starting a pairing
 * session, sending, disconnecting); owns the Postgres side of the
 * WhatsAppWebSession/Channel rows and relays status/QR events to the
 * frontend via the existing realtime infrastructure.
 */
@Injectable()
export class WhatsAppWebService {
  private readonly logger = new Logger(WhatsAppWebService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => MessagesService)) private readonly messagesService: MessagesService,
  ) {}

  private get sessionManagerUrl(): string {
    return this.config.get<string>('WHATSAPP_WEB_INTERNAL_URL', 'http://whatsapp-web:3004');
  }

  private get internalApiKey(): string {
    return this.config.get<string>('WHATSAPP_WEB_INTERNAL_API_KEY', '');
  }

  private async callSessionManager<T = unknown>(method: 'post' | 'get', path: string, data?: unknown): Promise<T> {
    const res = await axios.request<T>({
      method,
      url: `${this.sessionManagerUrl}${path}`,
      data,
      headers: { 'x-internal-api-key': this.internalApiKey },
      timeout: 15_000,
    });
    return res.data;
  }

  async startPairing(tenantId: string, userId: string, name?: string): Promise<{ channelId: string; sessionId: string }> {
    // [tenantId, type, name] is a real DB unique constraint -- disambiguate
    // deterministically rather than let the insert fail, same pattern
    // ChannelsService.upsertOAuthChannel already uses for OAuth channels.
    const baseName = name?.trim() || 'WhatsApp Web';
    let candidateName = baseName;
    let suffix = 1;
    while (await this.prisma.channel.findFirst({ where: { tenantId, type: ChannelType.WHATSAPP_WEB, name: candidateName } })) {
      suffix += 1;
      candidateName = `${baseName} ${suffix}`;
    }

    const channel = await this.prisma.channel.create({
      data: { tenantId, type: ChannelType.WHATSAPP_WEB, name: candidateName, isActive: true },
    });
    const session = await this.prisma.whatsAppWebSession.create({
      data: { tenantId, channelId: channel.id, status: 'QR_PENDING', connectedByUserId: userId },
    });

    try {
      await this.callSessionManager('post', '/sessions', { sessionId: session.id, tenantId, channelId: channel.id });
    } catch (err) {
      // Roll back the DB rows rather than leaving a permanently-broken
      // QR_PENDING channel behind if the session-manager itself is
      // unreachable -- the user gets a clean error and can just retry.
      await this.prisma.channel.delete({ where: { id: channel.id } }).catch(() => {});
      throw new BadRequestException(`Could not start the WhatsApp Web pairing session: ${err instanceof Error ? err.message : String(err)}`);
    }

    void this.audit.log({
      tenantId, userId, action: 'CREATE', resource: 'channel', resourceId: channel.id,
      metadata: { action: 'WHATSAPP_WEB_PAIRING_STARTED', name: candidateName },
    });

    return { channelId: channel.id, sessionId: session.id };
  }

  private async resolveConnectedSession(tenantId: string, channelId: string) {
    const session = await this.prisma.whatsAppWebSession.findFirst({ where: { tenantId, channelId } });
    if (!session) throw new BadRequestException('This conversation\'s WhatsApp Web channel is not connected.');
    if (session.status !== 'CONNECTED') {
      throw new BadRequestException('This conversation\'s WhatsApp Web session has been disconnected. Reconnect it in Settings to send messages.');
    }
    return session;
  }

  /** Called by MessagesService.dispatchOutbound() for a WHATSAPP_WEB conversation -- mirrors FacebookMessengerService's shape (resolve credentials/session, then send). */
  async sendText(tenantId: string, channelId: string, toPhone: string, text: string): Promise<string> {
    const session = await this.resolveConnectedSession(tenantId, channelId);
    const result = await this.callSessionManager<{ providerMessageId: string }>('post', `/sessions/${session.id}/send-text`, { toPhone, text });
    return result.providerMessageId;
  }

  async sendMedia(tenantId: string, channelId: string, toPhone: string, mediaUrl: string, mediaType: 'image' | 'video' | 'audio' | 'document', caption?: string): Promise<string> {
    const session = await this.resolveConnectedSession(tenantId, channelId);
    const result = await this.callSessionManager<{ providerMessageId: string }>('post', `/sessions/${session.id}/send-media`, { toPhone, mediaUrl, mediaType, caption });
    return result.providerMessageId;
  }

  /**
   * Includes the current QR (if any) alongside the DB-persisted status, so a
   * client that mounted the pairing modal late -- or missed the one-shot
   * 'qr'/'status' realtime push entirely (e.g. its socket was mid-reconnect
   * when the event was published; Socket.IO does not replay missed room
   * broadcasts) -- can catch up to the real current state on demand instead
   * of spinning forever on a bare loading screen. The QR image itself is
   * never persisted to Postgres (regenerated by Baileys every refresh cycle,
   * genuinely not worth storing) -- it's kept in memory on the session-
   * manager process and fetched live here, only while still relevant
   * (QR_PENDING); fails soft if the session-manager is briefly unreachable
   * rather than breaking an otherwise-working status check.
   */
  async getSessionStatus(tenantId: string, sessionId: string) {
    const session = await this.prisma.whatsAppWebSession.findFirst({ where: { id: sessionId, tenantId } });
    if (!session) throw new NotFoundException('WhatsApp Web session not found');

    let qrDataUrl: string | undefined;
    if (session.status === 'QR_PENDING') {
      qrDataUrl = await this.callSessionManager<{ active: boolean; qrDataUrl?: string }>('get', `/sessions/${sessionId}/status`)
        .then((r) => r.qrDataUrl)
        .catch(() => undefined);
    }

    return {
      sessionId: session.id,
      channelId: session.channelId,
      status: session.status,
      phoneNumber: session.phoneNumber,
      lastError: session.lastError,
      lastConnectedAt: session.lastConnectedAt,
      qrDataUrl,
    };
  }

  async disconnectSession(tenantId: string, sessionId: string, actorId?: string): Promise<void> {
    const session = await this.prisma.whatsAppWebSession.findFirst({ where: { id: sessionId, tenantId } });
    if (!session) throw new NotFoundException('WhatsApp Web session not found');

    await this.callSessionManager('post', `/sessions/${sessionId}/disconnect`).catch((err) => {
      this.logger.warn(`Failed to disconnect whatsapp-web session ${sessionId} on the session-manager: ${err instanceof Error ? err.message : String(err)}`);
    });

    await this.prisma.$transaction([
      this.prisma.whatsAppWebSession.update({ where: { id: sessionId }, data: { status: 'RECONNECTING' } }),
      this.prisma.channel.update({ where: { id: session.channelId }, data: { isActive: false } }),
    ]);

    void this.audit.log({
      tenantId, userId: actorId, action: 'UPDATE', resource: 'channel', resourceId: session.channelId,
      metadata: { action: 'WHATSAPP_WEB_DISCONNECTED' },
    });
  }

  /**
   * Resumes a RECONNECTING (or ERROR) session using its persisted auth state
   * -- no fresh QR scan needed, fulfilling the promise made when the session
   * was disconnected. Previously there was no code path that ever called
   * this: disconnectSession() leaves a session in RECONNECTING, but nothing
   * ever re-invoked the session-manager's connect() for it afterward except
   * a full process restart (SessionManager.restoreConnectedSessions(), which
   * only runs once at startup) -- so a disconnected channel was permanently
   * stuck with no way to resume short of restarting the whole whatsapp-web
   * container. The underlying /sessions session-manager endpoint already
   * supports resuming an existing session id (it's the same call
   * startPairing() makes for a brand-new one, and SessionManager.connect()
   * is already idempotent + loads persisted auth state) -- this just exposes
   * an on-demand way to invoke it for an existing session instead of only at
   * process bootstrap.
   */
  async reconnectSession(tenantId: string, sessionId: string, actorId?: string): Promise<void> {
    const session = await this.prisma.whatsAppWebSession.findFirst({ where: { id: sessionId, tenantId } });
    if (!session) throw new NotFoundException('WhatsApp Web session not found');
    if (session.status !== 'RECONNECTING' && session.status !== 'ERROR') {
      throw new BadRequestException(
        `Cannot reconnect a session with status "${session.status}" -- only a disconnected or failed session can be resumed this way. Scan a new QR code instead.`,
      );
    }

    await this.callSessionManager('post', '/sessions', { sessionId, tenantId, channelId: session.channelId });
    await this.prisma.channel.update({ where: { id: session.channelId }, data: { isActive: true } });

    void this.audit.log({
      tenantId, userId: actorId, action: 'UPDATE', resource: 'channel', resourceId: session.channelId,
      metadata: { action: 'WHATSAPP_WEB_RECONNECT_REQUESTED' },
    });
  }

  /** Fully unlinks the device (unlike disconnect, this can't be resumed -- a fresh QR scan is needed to reconnect). */
  async logoutSession(tenantId: string, sessionId: string, actorId?: string): Promise<void> {
    const session = await this.prisma.whatsAppWebSession.findFirst({ where: { id: sessionId, tenantId } });
    if (!session) throw new NotFoundException('WhatsApp Web session not found');

    await this.callSessionManager('post', `/sessions/${sessionId}/logout`).catch((err) => {
      this.logger.warn(`Failed to log out whatsapp-web session ${sessionId} on the session-manager: ${err instanceof Error ? err.message : String(err)}`);
    });

    await this.prisma.$transaction([
      this.prisma.whatsAppWebSession.update({
        where: { id: sessionId },
        data: { status: 'LOGGED_OUT', encryptedAuthState: null, phoneNumber: null },
      }),
      this.prisma.channel.update({ where: { id: session.channelId }, data: { isActive: false } }),
    ]);

    void this.audit.log({
      tenantId, userId: actorId, action: 'DELETE', resource: 'channel', resourceId: session.channelId,
      metadata: { action: 'WHATSAPP_WEB_LOGGED_OUT' },
    });
  }

  /**
   * Receives events posted by apps/whatsapp-web (QR ready, status changed,
   * or an inbound message arrived).
   */
  async handleInternalEvent(payload: WhatsAppWebEventPayload): Promise<void> {
    const sessionId = payload.sessionId as string | undefined;

    if (payload.type === 'qr' && sessionId) {
      const qrDataUrl = payload['qrDataUrl'] as string;
      this.realtime.emitWhatsAppWebQr(payload.tenantId, sessionId, payload.channelId, qrDataUrl);
      return;
    }

    if (payload.type === 'status' && sessionId) {
      const status = payload['status'] as string;
      const phoneNumber = payload['phoneNumber'] as string | undefined;
      await this.prisma.whatsAppWebSession.update({
        where: { id: sessionId },
        data: { status, ...(phoneNumber && { phoneNumber }) },
      }).catch((err) => {
        this.logger.warn(`Failed to persist WhatsApp Web session status for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
      });
      // The phone number isn't known at pairing time (startPairing creates the
      // Channel before any Baileys handshake happens) -- backfill it onto the
      // Channel here, the first time it's reported, so multiple linked
      // numbers stay disambiguated the same way Messenger's externalId (Page
      // ID) already disambiguates multiple connected Pages.
      if (phoneNumber) {
        await this.prisma.channel.update({
          where: { id: payload.channelId },
          data: { externalId: normalizePhone(phoneNumber) },
        }).catch((err) => {
          this.logger.warn(`Failed to backfill Channel.externalId for ${payload.channelId}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
      this.realtime.emitWhatsAppWebStatus(payload.tenantId, sessionId, payload.channelId, status, phoneNumber);
      return;
    }

    if (payload.type === 'message_status') {
      const providerMessageId = payload['providerMessageId'] as string | undefined;
      const status = payload['status'] as string | undefined;
      if (!providerMessageId || (status !== 'SENT' && status !== 'DELIVERED' && status !== 'READ')) {
        this.logger.warn(`Dropping malformed WhatsApp Web message_status event for channel ${payload.channelId}`);
        return;
      }
      await this.messagesService.updateStatus(providerMessageId, status as MessageStatus, payload.tenantId).catch((err) => {
        this.logger.error(`Failed to apply WhatsApp Web receipt for channel ${payload.channelId}: ${err instanceof Error ? err.message : String(err)}`);
      });
      return;
    }

    if (payload.type === 'inbound_message') {
      const fromPhone = payload['fromPhone'] as string | undefined;
      const providerMessageId = payload['providerMessageId'] as string | undefined;
      if (!fromPhone || !providerMessageId) {
        this.logger.warn(`Dropping malformed WhatsApp Web inbound_message event for channel ${payload.channelId} -- missing fromPhone/providerMessageId`);
        return;
      }
      await this.messagesService.handleInboundWhatsAppWeb(
        payload.tenantId,
        payload.channelId,
        fromPhone,
        providerMessageId,
        {
          content: payload['content'] as string | undefined,
          mediaType: payload['mediaType'] as 'image' | 'video' | 'audio' | 'document' | undefined,
          mediaBase64: payload['mediaBase64'] as string | undefined,
          mimetype: payload['mimetype'] as string | undefined,
          caption: payload['caption'] as string | undefined,
        },
        payload['pushName'] as string | undefined,
      ).catch((err) => {
        this.logger.error(`Failed to ingest inbound WhatsApp Web message for channel ${payload.channelId}: ${err instanceof Error ? err.message : String(err)}`);
      });
      return;
    }
  }
}
