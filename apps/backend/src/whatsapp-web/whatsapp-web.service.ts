import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ChannelType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuditService } from '../audit/audit.service';

interface WhatsAppWebEventPayload {
  type: 'qr' | 'status' | 'inbound_message';
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
  ) {}

  private get sessionManagerUrl(): string {
    return this.config.get<string>('WHATSAPP_WEB_INTERNAL_URL', 'http://whatsapp-web:3004');
  }

  private get internalApiKey(): string {
    return this.config.get<string>('WHATSAPP_WEB_INTERNAL_API_KEY', '');
  }

  private async callSessionManager<T = unknown>(method: 'post', path: string, data?: unknown): Promise<T> {
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

  async getSessionStatus(tenantId: string, sessionId: string) {
    const session = await this.prisma.whatsAppWebSession.findFirst({ where: { id: sessionId, tenantId } });
    if (!session) throw new NotFoundException('WhatsApp Web session not found');
    return {
      sessionId: session.id,
      channelId: session.channelId,
      status: session.status,
      phoneNumber: session.phoneNumber,
      lastError: session.lastError,
      lastConnectedAt: session.lastConnectedAt,
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
   * or an inbound message arrived). Inbound-message handling is a stub for
   * now -- Phase 4 wires it into the real message-ingestion pipeline, same
   * sequencing the Messenger channel's own webhook receiver used (stop at a
   * stubbed call, implement the real handler in the next phase).
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
      this.realtime.emitWhatsAppWebStatus(payload.tenantId, sessionId, payload.channelId, status, phoneNumber);
      return;
    }

    if (payload.type === 'inbound_message') {
      this.logger.debug(`Inbound WhatsApp Web message received for channel ${payload.channelId} -- ingestion not yet wired (Phase 4)`);
      return;
    }
  }
}
