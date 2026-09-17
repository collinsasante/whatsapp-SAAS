import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialsEncryptionService } from '../common/crypto/credentials-encryption.service';

const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0';

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
}
