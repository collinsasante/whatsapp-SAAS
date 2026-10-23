import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialsEncryptionService } from '../common/crypto/credentials-encryption.service';
import { ChannelType } from '@prisma/client';

const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0';
// Instagram's documented text limit. Meta rejects longer text, so say so up front instead of failing mid-send.
const INSTAGRAM_MAX_TEXT_CHARS = 1000;
const INSTAGRAM_MEDIA_TYPES = new Set(['image', 'video', 'audio']);

function metaError(error: unknown): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { error?: { message?: string } } | undefined;
    return data?.error?.message ?? error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Outbound Messenger Send API integration -- the FacebookPageConnection-based
 * counterpart to WhatsAppService, mirroring its shape (resolveCredentials,
 * per-method sends returning the provider message id) but for a Page's
 * PSID-addressed conversations instead of a WhatsAppNumber's phone-addressed
 * ones.
 */
@Injectable()
export class FacebookMessengerService {
  private readonly logger = new Logger(FacebookMessengerService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: CredentialsEncryptionService,
  ) {}

  async resolveCredentials(tenantId: string, channelId: string): Promise<{ pageAccessToken: string }> {
    const connection = await this.prisma.facebookPageConnection.findFirst({
      where: { tenantId, channelId },
    });
    if (!connection) {
      throw new BadRequestException('This conversation\'s Facebook Page is not connected.');
    }
    if (!connection.isActive) {
      throw new BadRequestException('This conversation\'s Facebook Page has been disconnected. Reconnect it in Settings to send messages.');
    }
    return { pageAccessToken: this.encryption.decrypt(connection.pageAccessToken) };
  }

  async sendTextMessage(tenantId: string, channelId: string, recipientPsid: string, text: string): Promise<string> {
    const { pageAccessToken } = await this.resolveCredentials(tenantId, channelId);
    try {
      const res = await axios.post<{ message_id: string }>(
        `${GRAPH_API_BASE}/me/messages`,
        { recipient: { id: recipientPsid }, message: { text }, messaging_type: 'RESPONSE' },
        { params: { access_token: pageAccessToken } },
      );
      return res.data.message_id;
    } catch (error) {
      const msg = metaError(error);
      this.logger.error(`Failed to send Messenger text message to ${recipientPsid}: ${msg}`);
      throw new BadRequestException(`Failed to send message: ${msg}`);
    }
  }

  // Messenger's Send API has no separate "caption" field for media the way
  // WhatsApp does -- when a caption is provided, it's sent as a follow-up
  // text message immediately after, the closest equivalent UX.
  async sendMediaMessage(
    tenantId: string, channelId: string, recipientPsid: string, mediaType: string, mediaUrl: string, caption?: string,
  ): Promise<string> {
    const { pageAccessToken } = await this.resolveCredentials(tenantId, channelId);
    const attachmentType = ['image', 'video', 'audio'].includes(mediaType) ? mediaType : 'file';
    try {
      const res = await axios.post<{ message_id: string }>(
        `${GRAPH_API_BASE}/me/messages`,
        {
          recipient: { id: recipientPsid },
          message: { attachment: { type: attachmentType, payload: { url: mediaUrl, is_reusable: true } } },
          messaging_type: 'RESPONSE',
        },
        { params: { access_token: pageAccessToken } },
      );
      if (caption) {
        await this.sendTextMessage(tenantId, channelId, recipientPsid, caption).catch((err) =>
          this.logger.warn(`Failed to send Messenger media caption as follow-up text: ${String(err)}`));
      }
      return res.data.message_id;
    } catch (error) {
      const msg = metaError(error);
      this.logger.error(`Failed to send Messenger media message to ${recipientPsid}: ${msg}`);
      throw new BadRequestException(`Failed to send media: ${msg}`);
    }
  }

  /**
   * The person's display name from Meta, for a contact we only know by an opaque id (otherwise the inbox shows
   * "Unknown"). Best effort and never throws: returns the reason when Meta says no, so the caller can log it. The
   * name itself is never logged.
   */
  async fetchContactName(
    tenantId: string, channelId: string, platform: 'MESSENGER' | 'INSTAGRAM', externalId: string,
  ): Promise<{ name: string | null; reason?: string }> {
    try {
      const token = platform === 'INSTAGRAM'
        ? (await this.resolveInstagramCredentials(tenantId, channelId)).accessToken
        : (await this.resolveCredentials(tenantId, channelId)).pageAccessToken;
      const res = await axios.get<{ name?: string; first_name?: string; last_name?: string; username?: string }>(
        `${GRAPH_API_BASE}/${encodeURIComponent(externalId)}`,
        { params: { fields: platform === 'INSTAGRAM' ? 'name,username' : 'name,first_name,last_name', access_token: token }, timeout: 8_000 },
      );
      const d = res.data;
      const name = d.name?.trim() || [d.first_name, d.last_name].filter(Boolean).join(' ').trim() || (d.username ? `@${d.username}` : '');
      return name ? { name } : { name: null, reason: 'Meta returned no name for this person' };
    } catch (error) {
      return { name: null, reason: metaError(error) };
    }
  }

  // ─── Instagram (Messenger Platform for Instagram, Facebook Login) ─────────────
  // Same Send API and Page access token as Messenger, addressed to an Instagram-scoped id (IGSID). The token is
  // kept on the Channel row (credentials.accessToken), not in FacebookPageConnection.

  async resolveInstagramCredentials(tenantId: string, channelId: string): Promise<{ accessToken: string }> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, tenantId, type: ChannelType.INSTAGRAM },
      select: { isActive: true, credentials: true },
    });
    if (!channel) {
      throw new BadRequestException('This conversation\'s Instagram account is not connected.');
    }
    if (!channel.isActive) {
      throw new BadRequestException('This conversation\'s Instagram account has been disconnected. Reconnect it in Channels to send messages.');
    }
    const stored = (channel.credentials as { accessToken?: string } | null)?.accessToken;
    if (!stored) {
      throw new BadRequestException('This Instagram account needs to be reconnected before it can send messages.');
    }
    return { accessToken: this.encryption.decrypt(stored) };
  }

  async sendInstagramTextMessage(tenantId: string, channelId: string, recipientIgsid: string, text: string): Promise<string> {
    if (text.length > INSTAGRAM_MAX_TEXT_CHARS) {
      throw new BadRequestException(`Instagram messages can be at most ${INSTAGRAM_MAX_TEXT_CHARS} characters. Shorten this message or split it in two.`);
    }
    const { accessToken } = await this.resolveInstagramCredentials(tenantId, channelId);
    try {
      const res = await axios.post<{ message_id: string }>(
        `${GRAPH_API_BASE}/me/messages`,
        { recipient: { id: recipientIgsid }, message: { text } },
        { params: { access_token: accessToken } },
      );
      return res.data.message_id;
    } catch (error) {
      const msg = metaError(error);
      this.logger.error(`Failed to send Instagram text message to ${recipientIgsid}: ${msg}`);
      throw new BadRequestException(`Failed to send message: ${msg}`);
    }
  }

  // Instagram accepts image, video and audio attachments (no documents). A caption goes as a follow-up text, as on
  // Messenger.
  async sendInstagramMediaMessage(
    tenantId: string, channelId: string, recipientIgsid: string, mediaType: string, mediaUrl: string, caption?: string,
  ): Promise<string> {
    if (!INSTAGRAM_MEDIA_TYPES.has(mediaType)) {
      throw new BadRequestException('Instagram only supports sending images, videos and audio. Send this file another way.');
    }
    const { accessToken } = await this.resolveInstagramCredentials(tenantId, channelId);
    try {
      const res = await axios.post<{ message_id: string }>(
        `${GRAPH_API_BASE}/me/messages`,
        { recipient: { id: recipientIgsid }, message: { attachment: { type: mediaType, payload: { url: mediaUrl } } } },
        { params: { access_token: accessToken } },
      );
      if (caption) {
        await this.sendInstagramTextMessage(tenantId, channelId, recipientIgsid, caption).catch((err) =>
          this.logger.warn(`Failed to send Instagram media caption as follow-up text: ${String(err)}`));
      }
      return res.data.message_id;
    } catch (error) {
      const msg = metaError(error);
      this.logger.error(`Failed to send Instagram media message to ${recipientIgsid}: ${msg}`);
      throw new BadRequestException(`Failed to send media: ${msg}`);
    }
  }
}
