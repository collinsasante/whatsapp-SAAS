import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import * as crypto from 'crypto';
import { ChannelType, Prisma } from '@prisma/client';
import { MessageType } from '@whatsapp-platform/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialsEncryptionService } from '../common/crypto/credentials-encryption.service';
import { StorageService } from '../media/storage.service';
import { MessagesService } from '../messages/messages.service';
import {
  TELEGRAM_MAX_CAPTION, TELEGRAM_MAX_DOWNLOAD_BYTES, TELEGRAM_MAX_TEXT, TelegramResult, telegramCall, telegramDownload,
} from './telegram-api.util';
import { normaliseTelegramUpdate, TelegramInboundAttachment, telegramMessageIdFromKey, telegramMessageKey } from './telegram-update.util';

export type TelegramHandleResult =
  | { status: 'stored'; messageId: string }
  | { status: 'duplicate' | 'ignored'; reason?: string };

const MESSAGE_TYPE: Record<'image' | 'video' | 'audio' | 'file', MessageType> = { image: MessageType.IMAGE, video: MessageType.VIDEO, audio: MessageType.AUDIO, file: MessageType.DOCUMENT };
const FALLBACK_MIME: Record<string, string> = { image: 'image/jpeg', video: 'video/mp4', audio: 'audio/ogg', file: 'application/octet-stream' };

interface TelegramCreds { botToken: string; botId: string }

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: CredentialsEncryptionService,
    private storage: StorageService,
    @Inject(forwardRef(() => MessagesService)) private messages: MessagesService,
  ) {}

  // ─── inbound ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * One webhook delivery. The CHANNEL (and through it the tenant) is resolved from the URL's channel id, and the request is accepted only if Telegram's
   * secret-token header equals the secret generated for that channel when the webhook was registered: nothing in the update body is trusted for ownership.
   */
  async handleUpdate(channelId: string, secretHeader: string | undefined, update: unknown): Promise<TelegramHandleResult> {
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, type: ChannelType.TELEGRAM } });
    if (!channel) throw new NotFoundException();
    const creds = (channel.credentials ?? {}) as Record<string, unknown>;
    const stored = typeof creds['webhookSecret'] === 'string' ? this.encryption.decrypt(creds['webhookSecret']) : '';
    if (!stored || !secretHeader || !this.safeEqual(stored, secretHeader)) throw new ForbiddenException();
    if (!channel.isActive) return { status: 'ignored', reason: 'channel-disconnected' };

    const n = normaliseTelegramUpdate(update);
    if (!n.ok) return { status: 'ignored', reason: n.reason };
    const { inbound } = n;
    const botId = channel.externalId ?? '';
    const mid = telegramMessageKey(botId, inbound.chatId, inbound.messageId);

    // Cheap duplicate check first: Telegram retries a delivery until it gets a 2xx, and a retry must not download the file again.
    if (await this.prisma.message.findFirst({ where: { tenantId: channel.tenantId, whatsappMessageId: mid }, select: { id: true } })) return { status: 'duplicate' };

    let prepared: { mediaUrl: string; mediaType: string; msgType: MessageType } | undefined;
    let placeholder = inbound.placeholder;
    if (inbound.attachment) {
      const token = typeof creds['botToken'] === 'string' ? this.encryption.decrypt(creds['botToken']) : '';
      const media = token ? await this.fetchAttachment(channel.tenantId, token, inbound.attachment) : { error: 'no bot token' as const };
      if ('mediaUrl' in media) prepared = media;
      else { placeholder = placeholder ?? `[${this.label(inbound.attachment.kind)} could not be downloaded]`; this.logger.warn(`Telegram attachment not stored for channel ${channel.id.slice(-6)} (${media.error})`); }
    }

    const stored2 = await this.messages.handleInboundMessenger(
      channel.tenantId, channel.id, inbound.chatId,
      { mid, text: inbound.text, displayText: placeholder, senderName: inbound.senderName, prepared },
      'TELEGRAM',
    );
    return { status: 'stored', messageId: (stored2 as { id: string }).id };
  }

  private label(kind: string) { return kind === 'image' ? 'Photo' : kind === 'video' ? 'Video' : kind === 'audio' ? 'Voice message' : 'File'; }

  private safeEqual(a: string, b: string): boolean {
    const ha = crypto.createHash('sha256').update(a).digest(); const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  private async fetchAttachment(tenantId: string, token: string, a: TelegramInboundAttachment): Promise<{ mediaUrl: string; mediaType: string; msgType: MessageType } | { error: string }> {
    if ((a.fileSize ?? 0) > TELEGRAM_MAX_DOWNLOAD_BYTES) return { error: 'file too large for the Bot API' };
    const info = await telegramCall<{ file_path?: string; file_size?: number }>(token, 'getFile', { file_id: a.fileId });
    if (!info.ok || !info.result?.file_path) return { error: `getFile ${info.errorCode ?? ''}` };
    const dl = await telegramDownload(token, info.result.file_path);
    if ('error' in dl) return { error: dl.error };
    const mime = (a.mimeType && a.mimeType !== 'application/octet-stream' ? a.mimeType : dl.mimeType) || FALLBACK_MIME[a.kind]!;
    const ext = (a.fileName?.split('.').pop() ?? info.result.file_path.split('.').pop() ?? mime.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
    const up = await this.storage.uploadRaw(dl.buffer, mime, tenantId, `telegram-${a.kind}.${ext}`);
    return { mediaUrl: up.fileUrl, mediaType: mime, msgType: MESSAGE_TYPE[a.kind] };
  }

  // ─── outbound ────────────────────────────────────────────────────────────────────────────────────

  private async resolve(tenantId: string, channelId: string): Promise<TelegramCreds> {
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, tenantId, type: ChannelType.TELEGRAM } });
    if (!channel) throw new BadRequestException('This conversation\'s Telegram bot is not connected.');
    if (!channel.isActive) throw new BadRequestException('This conversation\'s Telegram bot has been disconnected. Reconnect it in Channels to send messages.');
    const t = (channel.credentials as Record<string, unknown> | null)?.['botToken'];
    if (typeof t !== 'string' || !t) throw new BadRequestException('This Telegram bot needs to be reconnected before it can send messages.');
    return { botToken: this.encryption.decrypt(t), botId: channel.externalId ?? '' };
  }

  async sendText(tenantId: string, channelId: string, chatId: string, text: string, replyToKey?: string): Promise<string> {
    if (text.length > TELEGRAM_MAX_TEXT) throw new BadRequestException(`Telegram messages can be at most ${TELEGRAM_MAX_TEXT} characters. Shorten this message or split it in two.`);
    const { botToken, botId } = await this.resolve(tenantId, channelId);
    const reply = telegramMessageIdFromKey(replyToKey);
    const r = await telegramCall<{ message_id: number }>(botToken, 'sendMessage', { chat_id: chatId, text, ...(reply && { reply_parameters: { message_id: reply, allow_sending_without_reply: true } }) });
    return this.finishSend(tenantId, channelId, botId, chatId, r);
  }

  async sendMedia(
    tenantId: string, channelId: string, chatId: string, mediaType: MessageType,
    file: { buffer: Buffer; mimeType: string; filename: string }, caption?: string, replyToKey?: string,
  ): Promise<string> {
    const { botToken, botId } = await this.resolve(tenantId, channelId);
    const method = mediaType === MessageType.IMAGE ? 'sendPhoto'
      : mediaType === MessageType.VIDEO ? 'sendVideo'
      : mediaType === MessageType.AUDIO ? (/ogg|opus/i.test(file.mimeType) ? 'sendVoice' : 'sendAudio')
      : 'sendDocument';
    const field = method === 'sendPhoto' ? 'photo' : method === 'sendVideo' ? 'video' : method === 'sendVoice' ? 'voice' : method === 'sendAudio' ? 'audio' : 'document';
    if (file.buffer.length > 50 * 1024 * 1024) throw new BadRequestException('Telegram bots can send files up to 50 MB.');
    const useCaption = caption && caption.length <= TELEGRAM_MAX_CAPTION && method !== 'sendVoice' ? caption : undefined;
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set(field, new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.filename);
    if (useCaption) form.set('caption', useCaption);
    const reply = telegramMessageIdFromKey(replyToKey);
    if (reply) form.set('reply_parameters', JSON.stringify({ message_id: reply, allow_sending_without_reply: true }));
    const id = this.finishSend(tenantId, channelId, botId, chatId, await telegramCall<{ message_id: number }>(botToken, method, form, { timeoutMs: 60_000 }));
    const key = await id;
    // A caption Telegram would not take (too long, or on a voice note) goes as a follow-up text so nothing the agent wrote is lost.
    if (caption && !useCaption) await this.sendText(tenantId, channelId, chatId, caption.slice(0, TELEGRAM_MAX_TEXT)).catch((e) => this.logger.warn(`Telegram follow-up caption failed: ${e instanceof Error ? e.message : 'error'}`));
    return key;
  }

  private async finishSend(tenantId: string, channelId: string, botId: string, chatId: string, r: TelegramResult<{ message_id: number }>): Promise<string> {
    if (r.ok && typeof r.result?.message_id === 'number') return telegramMessageKey(botId, chatId, r.result.message_id);
    const d = (r.description ?? '').toLowerCase();
    if (r.errorCode === 401) {
      await this.markCredentials(tenantId, channelId, 'CREDENTIALS_INVALID').catch(() => undefined);
      throw new BadRequestException('Telegram no longer accepts this bot\'s token. Reconnect the bot in Channels.');
    }
    if (r.errorCode === 403) throw new BadRequestException(d.includes('blocked') ? 'This person has blocked the bot, so Telegram will not deliver messages to them.' : 'Telegram will not let this bot message this chat (the person left or the bot was removed).');
    if (r.errorCode === 400 && d.includes('chat not found')) throw new BadRequestException('Telegram cannot find this chat. The person must message the bot first.');
    if (r.errorCode === 429) throw new BadRequestException('Telegram is rate limiting this bot. Try again in a moment.');
    if (r.errorCode === 0) throw new BadRequestException('Telegram could not be reached. Try again in a moment.');
    this.logger.warn(`Telegram send rejected for channel ${channelId.slice(-6)}: code ${r.errorCode ?? '?'} ${r.description ?? ''}`.slice(0, 220));
    throw new BadRequestException(`Telegram rejected the message (error ${r.errorCode ?? 'unknown'}).`);
  }

  private async markCredentials(tenantId: string, channelId: string, status: string) {
    const c = await this.prisma.channel.findFirst({ where: { id: channelId, tenantId }, select: { metadata: true } });
    const md = (c?.metadata && typeof c.metadata === 'object' && !Array.isArray(c.metadata) ? c.metadata : {}) as Record<string, unknown>;
    await this.prisma.channel.updateMany({ where: { id: channelId, tenantId }, data: { metadata: { ...md, telegram: { status, at: new Date().toISOString() } } as Prisma.InputJsonValue } });
  }
}
