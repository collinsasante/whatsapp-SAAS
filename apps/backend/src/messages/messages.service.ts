import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ContactsService } from '../contacts/contacts.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StorageService } from '../media/storage.service';
import { ChatbotFlowsService, FlowNode } from '../chatbot-flows/chatbot-flows.service';
import { AiResponderService } from '../ai/ai-responder.service';
import { EscalationService, EscalationReason } from '../ai/escalation.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { AiLogsService } from '../ai-logs/ai-logs.service';
import { SendMessageDto } from './dto/message.dto';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { MessageType, MessageDirection, MessageStatus, ActivityAction, UserRole } from '@whatsapp-platform/shared-types';
import { buildPaginationMeta, getPaginationSkip, interpolateTemplate } from '@whatsapp-platform/shared-utils';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private prisma: PrismaService,
    private whatsappService: WhatsAppService,
    private conversationsService: ConversationsService,
    private contactsService: ContactsService,
    private realtimeService: RealtimeService,
    private storageService: StorageService,
    private chatbotFlowsService: ChatbotFlowsService,
    private activityLogService: ActivityLogService,
    private aiResponderService: AiResponderService,
    private escalationService: EscalationService,
    private knowledgeBaseService: KnowledgeBaseService,
    private aiLogsService: AiLogsService,
  ) {}

  async sendMessage(tenantId: string, conversationId: string, senderId: string, dto: SendMessageDto, senderRole?: UserRole) {
    console.log(`[sendMessage] type=${dto.type} templateId=${dto.templateId} content=${dto.content}`);
    const conversation = await this.conversationsService.findOne(tenantId, conversationId);
    const contact = await this.contactsService.findOne(tenantId, conversation.contactId);

    if (contact.isBlocked || contact.optedOut) {
      throw new NotFoundException('Cannot send message to this contact');
    }


    // Auto-reopen resolved conversation when agent sends a message
    if (conversation.status === 'RESOLVED') {
      await this.conversationsService.autoReopenIfResolved(conversationId, tenantId, conversation.contact?.id ?? conversation.contactId);
    }

    const messageMetadata: Record<string, unknown> = {};
    if (dto.type === MessageType.LOCATION) {
      messageMetadata['latitude'] = dto.locationLatitude;
      messageMetadata['longitude'] = dto.locationLongitude;
      if (dto.locationName) messageMetadata['name'] = dto.locationName;
      if (dto.locationAddress) messageMetadata['address'] = dto.locationAddress;
    } else if (dto.type === MessageType.CONTACTS) {
      messageMetadata['contactName'] = dto.contactName;
      messageMetadata['contactPhone'] = dto.contactPhone;
    }

    // For template messages, resolve the body text so it renders in the chat
    let resolvedContent = dto.content ?? null;
    if (dto.type === MessageType.TEMPLATE && dto.templateId) {
      const tpl = await this.prisma.template.findFirst({ where: { id: dto.templateId, tenantId } });
      console.log(`[template] resolving content templateId=${dto.templateId} found=${!!tpl}`);
      if (tpl) {
        const bodyComp = (tpl.components as Array<{ type: string; text?: string }>).find((c) => c.type === 'BODY');
        if (bodyComp?.text) {
          resolvedContent = interpolateTemplate(bodyComp.text, dto.templateVariables ?? {});
          console.log(`[template] resolvedContent="${resolvedContent?.slice(0, 60)}"`);
        }
      }
    }

    const message = await this.prisma.message.create({
      data: {
        tenantId,
        conversationId,
        contactId: contact.id,
        senderId,
        replyToId: dto.replyToId ?? null,
        direction: MessageDirection.OUTBOUND,
        type: (dto.type as MessageType) ?? MessageType.TEXT,
        status: MessageStatus.QUEUED,
        content: resolvedContent,
        mediaUrl: dto.mediaUrl,
        mediaCaption: dto.mediaCaption,
        templateId: dto.templateId,
        templateVariables: dto.templateVariables ?? undefined,
        metadata: Object.keys(messageMetadata).length > 0 ? (messageMetadata as Prisma.InputJsonValue) : undefined,
      },
      include: {
        replyTo: { select: { id: true, content: true, type: true, direction: true, mediaCaption: true } },
      },
    });

    // Resolve the WhatsApp message ID of the message being replied to (for context field)
    let replyToWaMessageId: string | undefined;
    if (dto.replyToId) {
      const replyToMsg = await this.prisma.message.findFirst({
        where: { id: dto.replyToId, conversationId },
        select: { whatsappMessageId: true },
      });
      const rawId = replyToMsg?.whatsappMessageId;
      // Only use the wamid if it's a valid WhatsApp message ID (starts with "wamid.")
      replyToWaMessageId = rawId?.startsWith('wamid.') ? rawId : undefined;
    }

    let whatsappMessageId: string | undefined;

    try {
      if (dto.type === MessageType.TEXT || !dto.type) {
        whatsappMessageId = await this.whatsappService.sendTextMessage(tenantId, contact.phone, dto.content!, replyToWaMessageId);
      } else if (([MessageType.IMAGE, MessageType.VIDEO, MessageType.AUDIO, MessageType.DOCUMENT] as MessageType[]).includes(dto.type as MessageType)) {
        // Upload media to Meta first to get a media_id (more reliable than link-based send)
        if (dto.mediaUrl) {
          const defaultMime: Record<string, string> = {
            [MessageType.AUDIO]: 'audio/ogg',
            [MessageType.VIDEO]: 'video/mp4',
            [MessageType.IMAGE]: 'image/jpeg',
            [MessageType.DOCUMENT]: 'application/pdf',
          };
          try {
            let mediaBuffer: Buffer | null = null;
            let mimeType = defaultMime[dto.type as string] ?? 'application/octet-stream';

            const proxyMatch = dto.mediaUrl.match(/\/api\/v1\/media\/serve\/(.+)/);
            if (proxyMatch) {
              const fileKey = proxyMatch[1].replace(/~/g, '/');
              const downloaded = await this.storageService.downloadBuffer(fileKey);
              if (downloaded) {
                mediaBuffer = downloaded.buffer;
                mimeType = downloaded.mimeType || mimeType;
              }
            }

            if (!mediaBuffer) {
              const dlRes = await axios.get<ArrayBuffer>(dto.mediaUrl, { responseType: 'arraybuffer', timeout: 120_000 });
              mediaBuffer = Buffer.from(dlRes.data);
              mimeType = (dlRes.headers['content-type'] as string | undefined) ?? mimeType;
            }

            const ext = mimeType.split('/')[1]?.split(';')[0] ?? 'bin';
            const metaMediaId = await this.whatsappService.uploadMediaToMeta(tenantId, mediaBuffer, mimeType, `media.${ext}`);
            whatsappMessageId = await this.whatsappService.sendMediaMessageById(
              tenantId,
              contact.phone,
              dto.type.toLowerCase(),
              metaMediaId,
              dto.mediaCaption,
              replyToWaMessageId,
            );
          } catch {
            // fallback to link-based send
            whatsappMessageId = await this.whatsappService.sendMediaMessage(tenantId, contact.phone, dto.type.toLowerCase(), dto.mediaUrl!, dto.mediaCaption, replyToWaMessageId);
          }
        }
      } else if (dto.type === MessageType.TEMPLATE && dto.templateId) {
        const template = await this.prisma.template.findFirst({
          where: { id: dto.templateId, tenantId },
        });
        if (template) {
          whatsappMessageId = await this.whatsappService.sendTemplateMessage(
            tenantId,
            contact.phone,
            template.name,
            template.language,
            template.components as never,
            dto.templateVariables ?? {},
          );
        }
      } else if (dto.type === MessageType.LOCATION && dto.locationLatitude != null && dto.locationLongitude != null) {
        whatsappMessageId = await this.whatsappService.sendLocationMessage(
          tenantId,
          contact.phone,
          dto.locationLatitude,
          dto.locationLongitude,
          dto.locationName,
          dto.locationAddress,
        );
      } else if (dto.type === MessageType.CONTACTS && dto.contactName && dto.contactPhone) {
        whatsappMessageId = await this.whatsappService.sendContactMessage(
          tenantId,
          contact.phone,
          dto.contactName,
          dto.contactPhone,
        );
      }

      await this.prisma.message.update({
        where: { id: message.id },
        data: {
          whatsappMessageId,
          status: MessageStatus.SENT,
          sentAt: new Date(),
        },
      });

      await this.conversationsService.incrementUnread(conversationId);

      // Trigger real-time AI learning from this agent reply (throttled to once per 30 min per tenant)
      if (dto.type === MessageType.TEXT || !dto.type) {
        this.knowledgeBaseService.triggerLearningAsync(tenantId);
      }

      const updatedMessage = await this.prisma.message.findUnique({
        where: { id: message.id },
        include: {
          sender: { select: { id: true, name: true, avatarUrl: true } },
          replyTo: { select: { id: true, content: true, type: true, direction: true, mediaCaption: true } },
        },
      });
      this.realtimeService.emitNewMessage(tenantId, conversationId, updatedMessage!);

      return updatedMessage;
    } catch (error) {
      const failedMessage = await this.prisma.message.update({
        where: { id: message.id },
        data: {
          status: MessageStatus.FAILED,
          failedAt: new Date(),
          failureReason: error instanceof Error ? error.message : 'Unknown error',
        },
        include: { replyTo: { select: { id: true, content: true, type: true, direction: true, mediaCaption: true } } },
      });
      // Emit as failed so UI updates in real-time, but don't throw — return 201 with failed status
      this.realtimeService.emitNewMessage(tenantId, conversationId, failedMessage);
      return failedMessage;
    }
  }

  async findByConversation(tenantId: string, conversationId: string, page = 1, limit = 50, search?: string, before?: string) {
    const conversation = await this.conversationsService.findOne(tenantId, conversationId);

    const msgInclude = {
      sender: { select: { id: true, name: true, avatarUrl: true } },
      replyTo: { select: { id: true, content: true, type: true, direction: true, mediaCaption: true } },
      reactions: { select: { id: true, emoji: true, userId: true } },
    };

    // Search mode — return flat ascending list
    if (search?.trim()) {
      const where = { conversationId: conversation.id, deletedForEveryone: false, content: { contains: search.trim(), mode: 'insensitive' as const } };
      const [data, total] = await Promise.all([
        this.prisma.message.findMany({ where, orderBy: { createdAt: 'asc' }, take: 200, include: msgInclude }),
        this.prisma.message.count({ where }),
      ]);
      return { data, hasMore: false, meta: buildPaginationMeta(total, page, limit) };
    }

    const baseWhere: Prisma.MessageWhereInput = {
      conversationId: conversation.id,
      deletedForEveryone: false,
    };

    // Cursor load — messages strictly before the given ISO timestamp, newest-of-those first
    if (before) {
      const beforeDate = new Date(before);
      const data = await this.prisma.message.findMany({
        where: { ...baseWhere, createdAt: { lt: beforeDate } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: msgInclude,
      });
      return { data: data.reverse(), hasMore: data.length === limit };
    }

    // Initial load — return the most recent `limit` messages in ascending order
    const [data, total] = await Promise.all([
      this.prisma.message.findMany({
        where: baseWhere,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: msgInclude,
      }),
      this.prisma.message.count({ where: baseWhere }),
    ]);
    return { data: data.reverse(), hasMore: total > limit, meta: buildPaginationMeta(total, 1, limit) };
  }

  async handleInbound(tenantId: string, waMessage: {
    id: string;
    from: string;
    timestamp: string;
    type: string;
    context?: { id: string; from?: string; forwarded?: boolean };
    text?: { body: string };
    image?: { id: string; mime_type: string; sha256: string; caption?: string };
    video?: { id: string; mime_type: string };
    audio?: { id: string; mime_type: string };
    document?: { id: string; mime_type: string; filename?: string };
    sticker?: { id: string; mime_type: string; animated?: boolean };
    reaction?: { message_id: string; emoji: string };
    location?: { latitude: number; longitude: number; name?: string; address?: string };
    contacts?: Array<{ name: { formatted_name: string }; phones?: Array<{ phone: string }> }>;
    interactive?: {
      type: 'list_reply' | 'button_reply' | 'call_permission_reply';
      list_reply?: { id: string; title: string };
      button_reply?: { id: string; title: string };
      call_permission_reply?: { response: string };
    };
  }, profileName?: string, incomingPhoneNumberId?: string, referral?: {
    source_url?: string; source_type?: string; source_id?: string; headline?: string; body?: string;
    image_url?: string; media_type?: string; ctwa_clid?: string;
  }) {
    // Handle call permission reply — intercept before anything else so it never gets stored
    // as a regular inbound message or reopens a conversation.
    if (waMessage.type === 'interactive' && waMessage.interactive?.type === 'call_permission_reply') {
      const response = waMessage.interactive.call_permission_reply?.response ?? '';
      console.log(`[call_permission] ${response} from ${waMessage.from}`);
      this.realtimeService.emitCallEvent(tenantId, 'call_permission_updated', {
        phone: waMessage.from,
        response,
        granted: response === 'ACCEPTED',
      });
      return null;
    }

    // Handle CSAT survey reply BEFORE findOrCreate — prevents reopening the resolved conversation
    // and ensures the score is written back to the correct (resolved) conversation so resolvedById
    // remains intact and the agent's rating appears in the analytics table.
    if (waMessage.type === 'interactive' && waMessage.interactive) {
      const replyId = waMessage.interactive.list_reply?.id ?? waMessage.interactive.button_reply?.id ?? '';
      if (replyId.startsWith('csat_')) {
        const score = parseInt(replyId.replace('csat_', ''), 10);
        if (score >= 1 && score <= 5) {
          const contact = await this.contactsService.findOrCreate(tenantId, waMessage.from, profileName);
          // Find the most-recently resolved conversation for this contact that hasn't been rated yet
          const resolvedConv = await this.prisma.conversation.findFirst({
            where: { tenantId, contactId: contact.id, csatScore: null, resolvedAt: { not: null } },
            orderBy: { resolvedAt: 'desc' },
            select: { id: true },
          });
          if (resolvedConv) {
            // Atomic update — only one concurrent webhook delivery wins; prevents duplicate sends
            const updated = await this.prisma.conversation.updateMany({
              where: { id: resolvedConv.id, csatScore: null },
              data: { csatScore: score, csatSubmittedAt: new Date() } as { csatScore: number; csatSubmittedAt: Date },
            });
            if (updated.count > 0) {
              void this.activityLogService.log({
                tenantId,
                action: ActivityAction.SURVEY_RESPONSE,
                conversationId: resolvedConv.id,
                contactId: contact.id,
                metadata: { score },
              });
              const thankYouText = 'Thank you for your feedback! We really appreciate you taking the time to rate your experience.';
              const msg = await this.prisma.message.create({
                data: {
                  tenantId,
                  conversationId: resolvedConv.id,
                  contactId: contact.id,
                  direction: MessageDirection.OUTBOUND,
                  type: MessageType.TEXT,
                  status: MessageStatus.QUEUED,
                  content: thankYouText,
                },
              });
              const waId = await this.whatsappService.sendTextMessage(tenantId, contact.phone, thankYouText).catch(() => null);
              const sentMsg = await this.prisma.message.update({
                where: { id: msg.id },
                data: {
                  whatsappMessageId: waId ?? undefined,
                  status: waId ? MessageStatus.SENT : MessageStatus.FAILED,
                  sentAt: waId ? new Date() : undefined,
                },
              });
              this.realtimeService.emitNewMessage(tenantId, resolvedConv.id, sentMsg as unknown as Record<string, unknown>);
            }
          }
          return null;
        }
      }
    }

    // Idempotency: skip if this WA message was already processed for this tenant.
    // Protects against Meta webhook retries AND fan-out re-delivery.
    const alreadyProcessed = await this.prisma.message.findFirst({
      where: { whatsappMessageId: waMessage.id, tenantId },
      select: { id: true },
    });
    if (alreadyProcessed) return alreadyProcessed;

    const contact = await this.contactsService.findOrCreate(tenantId, waMessage.from, profileName);

    // Mirror the Facebook CDN ad-preview image to our own storage so the URL never expires.
    let permanentAdImageUrl: string | undefined;
    if (referral?.image_url) {
      try {
        const imgResp = await axios.get<Buffer>(referral.image_url, { responseType: 'arraybuffer', timeout: 10_000 });
        const contentType = (imgResp.headers['content-type'] as string | undefined) ?? 'image/jpeg';
        const ext = contentType.split('/')[1]?.split(';')[0] ?? 'jpg';
        const { fileUrl } = await this.storageService.uploadRaw(
          Buffer.from(imgResp.data),
          contentType,
          tenantId,
          `ad-preview.${ext}`,
        );
        permanentAdImageUrl = fileUrl;
      } catch (err) {
        this.logger.warn(`Failed to mirror ad preview image: ${(err as Error).message}`);
        permanentAdImageUrl = referral.image_url;
      }
    }

    const conversation = await this.conversationsService.findOrCreate(tenantId, contact.id, referral
      ? {
          contactSource: referral.source_type ?? 'ad',
          adSourceId: referral.source_id,
          adHeadline: referral.headline,
          adImageUrl: permanentAdImageUrl,
        }
      : undefined,
    );

    // Tag conversation with which WhatsApp number received this message (first time only)
    if (incomingPhoneNumberId && !conversation.whatsappNumberId) {
      const waNum = await this.prisma.whatsAppNumber.findUnique({
        where: { tenantId_phoneNumberId: { tenantId, phoneNumberId: incomingPhoneNumberId } },
        select: { id: true },
      });
      if (waNum) {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { whatsappNumberId: waNum.id },
        });
        (conversation as { whatsappNumberId?: string }).whatsappNumberId = waNum.id;
      }
    }

    // Migrate any legacy OPEN conversations to REQUESTING on next inbound message
    if (conversation.status === 'OPEN') {
      await this.conversationsService.request(tenantId, conversation.id);
    }

    // Handle customer-deleted message — mark it deleted in our DB
    if (waMessage.type === 'deleted') {
      return null;
    }

    // Handle incoming reaction — update DB reaction, don't create a new message
    if (waMessage.type === 'reaction' && waMessage.reaction) {
      const targetMsg = await this.prisma.message.findFirst({
        where: { whatsappMessageId: waMessage.reaction.message_id, tenantId },
      });
      if (targetMsg) {
        const emoji = waMessage.reaction.emoji;
        if (emoji) {
          await this.prisma.messageReaction.upsert({
            where: { messageId_userId_emoji: { messageId: targetMsg.id, userId: contact.id, emoji } },
            create: { messageId: targetMsg.id, tenantId, userId: contact.id, emoji },
            update: {},
          });
        } else {
          // Empty emoji = remove all reactions from this contact on this message
          await this.prisma.messageReaction.deleteMany({ where: { messageId: targetMsg.id, userId: contact.id } });
        }
        const updatedReactions = await this.prisma.messageReaction.findMany({
          where: { messageId: targetMsg.id },
          select: { id: true, emoji: true, userId: true },
        });
        this.realtimeService.emitReactionUpdated(tenantId, conversation.id, targetMsg.id, updatedReactions);
      }
      return null;
    }

    let content: string | undefined;
    let mediaUrl: string | undefined;
    let mediaType: string | undefined;
    let mediaCaption: string | undefined;
    const messageMetadata: Record<string, unknown> = {};

    const msgType = waMessage.type.toUpperCase() as MessageType;

    // WhatsApp sends type="unsupported" for polls, ephemeral messages, and
    // other types not yet exposed via the Cloud API. Skip them silently
    // (we already acknowledged the webhook — no need to crash).
    const validMessageTypes = new Set<string>(Object.values(MessageType));
    if (!validMessageTypes.has(msgType)) {
      this.logger.debug(`[tenant:${tenantId}] Skipping unsupported WA message type "${waMessage.type}"`);
      return null;
    }

    if (waMessage.text) content = waMessage.text.body;

    if (waMessage.location) {
      messageMetadata['latitude'] = waMessage.location.latitude;
      messageMetadata['longitude'] = waMessage.location.longitude;
      if (waMessage.location.name) messageMetadata['name'] = waMessage.location.name;
      if (waMessage.location.address) messageMetadata['address'] = waMessage.location.address;
      content = [waMessage.location.name, waMessage.location.address].filter(Boolean).join(', ') || 'Location';
    }

    if (waMessage.contacts?.[0]) {
      const c = waMessage.contacts[0];
      messageMetadata['contactName'] = c.name.formatted_name;
      messageMetadata['contactPhone'] = c.phones?.[0]?.phone ?? '';
      content = c.name.formatted_name;
    }

    const mediaId = waMessage.image?.id ?? waMessage.video?.id ?? waMessage.audio?.id ?? waMessage.document?.id ?? waMessage.sticker?.id;
    if (mediaId) {
      let filename = 'media';
      if (waMessage.image) { mediaType = waMessage.image.mime_type; mediaCaption = waMessage.image.caption; filename = 'image'; }
      else if (waMessage.video) { mediaType = waMessage.video.mime_type; filename = 'video'; }
      else if (waMessage.audio) { mediaType = waMessage.audio.mime_type; filename = 'audio'; }
      else if (waMessage.document) { mediaType = waMessage.document.mime_type; mediaCaption = waMessage.document.filename; filename = waMessage.document.filename ?? 'document'; }
      else if (waMessage.sticker) { mediaType = waMessage.sticker.mime_type; filename = 'sticker'; }

      const downloaded = await this.whatsappService.downloadMetaMedia(tenantId, mediaId);
      if (downloaded) {
        const ext = downloaded.mimeType.split('/')[1]?.split(';')[0] ?? 'bin';
        const uploadResult = await this.storageService.uploadRaw(
          downloaded.buffer,
          downloaded.mimeType,
          tenantId,
          `${filename}.${ext}`,
        );
        mediaUrl = uploadResult.fileUrl;
      }
    }

    if (waMessage.context?.forwarded) {
      messageMetadata['isForwarded'] = true;
    }

    // Resolve replyToId from WhatsApp context field
    let replyToId: string | null = null;
    if (waMessage.context?.id) {
      const contextMsg = await this.prisma.message.findFirst({
        where: { whatsappMessageId: waMessage.context.id, tenantId },
        select: { id: true },
      });
      replyToId = contextMsg?.id ?? null;
    }

    // Atomic: create message and increment conversation unread count together
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          contactId: contact.id,
          whatsappMessageId: waMessage.id,
          replyToId,
          direction: MessageDirection.INBOUND,
          type: msgType,
          status: MessageStatus.DELIVERED,
          content,
          mediaUrl,
          mediaType,
          mediaCaption,
          metadata: Object.keys(messageMetadata).length > 0 ? (messageMetadata as Prisma.InputJsonValue) : undefined,
          deliveredAt: new Date(),
        },
        include: {
          replyTo: { select: { id: true, content: true, type: true, direction: true, mediaCaption: true } },
        },
      }),
      this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { unreadCount: { increment: 1 }, lastMessageAt: new Date() },
      }),
    ]);
    this.realtimeService.emitNewMessage(tenantId, conversation.id, message);
    this.realtimeService.emitConversationUpdated(tenantId, conversation.id, {
      id: conversation.id,
      unreadCount: (conversation.unreadCount ?? 0) + 1,
      lastMessageAt: message.createdAt,
      lastInboundAt: message.createdAt,
      contact: (conversation as Record<string, unknown>)['contact'],
      status: conversation.status,
      assignedTo: (conversation as Record<string, unknown>)['assignedTo'],
      labels: (conversation as Record<string, unknown>)['labels'] ?? [],
      channel: (conversation as Record<string, unknown>)['channel'] ?? null,
    });

    // Campaign reply tracking: if this contact's most recent campaign send hasn't been
    // marked as replied yet, this inbound message counts as their reply to it.
    void (async () => {
      try {
        const recipient = await this.prisma.campaignRecipient.findFirst({
          where: { contactId: contact.id, sentAt: { not: null, lte: message.createdAt }, repliedAt: null },
          orderBy: { sentAt: 'desc' },
        });
        if (!recipient) return;
        // Atomic update — only one concurrent webhook delivery wins; prevents double-counting.
        const updated = await this.prisma.campaignRecipient.updateMany({
          where: { id: recipient.id, repliedAt: null },
          data: { repliedAt: message.createdAt },
        });
        if (updated.count > 0) {
          await this.prisma.campaign.update({
            where: { id: recipient.campaignId },
            data: { repliedCount: { increment: 1 } },
          });
        }
      } catch (err) {
        this.logger.warn(`Campaign reply tracking failed: ${(err as Error).message}`);
      }
    })();

    // Send welcome message on first inbound message from this contact today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const priorMessageCount = await this.prisma.message.count({
      where: { tenantId, conversation: { contactId: contact.id }, direction: MessageDirection.INBOUND, id: { not: message.id }, createdAt: { gte: startOfDay } },
    });
    if (priorMessageCount === 0) {
      const tenantSettings = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { welcomeEnabled: true, welcomeMessage: true } });
      if (tenantSettings?.welcomeEnabled && tenantSettings.welcomeMessage) {
        void (async () => {
          try {
            const welcomeText = tenantSettings.welcomeMessage!;
            const draft = await this.prisma.message.create({
              data: { tenantId, conversationId: conversation.id, contactId: contact.id, direction: MessageDirection.OUTBOUND, type: MessageType.TEXT, status: MessageStatus.QUEUED, content: welcomeText, metadata: { isAutoReply: true } as never },
            });
            const waId = await this.whatsappService.sendTextMessage(tenantId, contact.phone, welcomeText).catch(() => null);
            const sent = await this.prisma.message.update({
              where: { id: draft.id },
              data: { whatsappMessageId: waId ?? undefined, status: waId ? MessageStatus.SENT : MessageStatus.FAILED, sentAt: waId ? new Date() : undefined },
            });
            this.realtimeService.emitNewMessage(tenantId, conversation.id, sent as unknown as Record<string, unknown>);
            this.logger.log(`Welcome message sent to ${contact.phone}`);
          } catch (err: unknown) {
            this.logger.error(`Welcome message failed for ${contact.phone}: ${(err as Error).message}`);
          }
        })();
      } else {
        this.logger.debug(`Welcome skipped: enabled=${tenantSettings?.welcomeEnabled} hasMsg=${!!tenantSettings?.welcomeMessage}`);
      }
    }

    // Trigger chatbot flow if one matches this message
    let flowMatched = false;
    if (content) {
      const flow = await this.chatbotFlowsService.findMatchingFlow(tenantId, content);
      if (flow) {
        flowMatched = true;
        void this.runBotFlow(tenantId, conversation.id, { id: contact.id, phone: contact.phone }, flow.nodes as unknown as FlowNode[]);
      }
    }

    // AI responder: suggestion mode or auto-reply (only if no chatbot flow matched)
    // Skip if a human agent has taken over (assignedTo exists and is not an AI agent)
    const assignedTo = (conversation as typeof conversation & { assignedTo?: { id: string; isAiAgent?: boolean } | null }).assignedTo;
    const humanOwned = assignedTo && !assignedTo.isAiAgent;
    if (content && !flowMatched && !humanOwned) {
      void this.handleAiResponse(tenantId, conversation.id, contact, content, assignedTo ?? null)
        .catch((err) => this.logger.error(`AI responder pipeline error: ${(err as Error).message}`));
    }

    return message;
  }

  /**
   * Full Verz AI pipeline for one inbound customer message: pre-generation
   * escalation checks (human request / frustration / loop protection) run
   * BEFORE any model call, since they're cheap and some (human request) must
   * win regardless of what the model would say. Then generation + the
   * confidence/verification gate for AUTO_REPLY. SUGGESTION mode always
   * shows the agent whatever Verz produced (or nothing, on a hard failure);
   * AUTO_REPLY only ever sends when action=ANSWER, verification passed, and
   * confidence clears the tenant's threshold -- anything else becomes a
   * human-queue escalation with the tenant's holding message, and no credit
   * is deducted for a blocked send.
   */
  private async handleAiResponse(
    tenantId: string,
    conversationId: string,
    contact: { id: string; phone: string; name?: string | null },
    content: string,
    assignedTo: { id: string; isAiAgent?: boolean } | null,
  ) {
    const [aiMode, aiSettings] = await Promise.all([
      this.aiResponderService.getMode(tenantId).catch(() => null),
      this.prisma.tenantSettings.findUnique({
        where: { tenantId },
        select: { aiHoldingMessage: true, aiConfidenceThreshold: true, aiMaxConsecutiveReplies: true },
      }),
    ]);
    if (aiMode !== 'SUGGESTION' && aiMode !== 'AUTO_REPLY') return;

    // --- Pre-generation escalation checks (cheapest path -- never call the model) ---
    let preReason: EscalationReason | null = this.escalationService.detectHumanIntent(content) ? 'human_request' : null;

    if (!preReason) {
      const recentInbound = await this.prisma.message.findMany({
        where: { tenantId, conversationId, direction: 'INBOUND', type: 'TEXT', content: { not: null } },
        orderBy: { createdAt: 'desc' }, take: 3, select: { content: true },
      });
      if (this.escalationService.detectFrustration(content, recentInbound.map((m) => m.content!).reverse())) {
        preReason = 'frustration';
      }
    }

    if (!preReason) {
      const maxConsecutive = aiSettings?.aiMaxConsecutiveReplies ?? 5;
      if (await this.escalationService.isLoopProtectionTriggered(tenantId, conversationId, maxConsecutive)) {
        preReason = 'loop_protection';
      }
    }

    if (preReason) {
      await this.escalateConversation({
        tenantId, conversationId, contact, customerQuestion: content, reason: preReason,
        draftReply: null, aiMode, holdingMessage: aiSettings?.aiHoldingMessage ?? null, assignedTo,
      });
      return;
    }

    // --- Generation (retrieval + grounded prompt + verification happen inside) ---
    const result = await this.aiResponderService.generateSuggestion(tenantId, conversationId, content, contact.name ?? undefined);
    if (!result.response) return; // model call failed entirely after retries -- log nothing, don't leave a broken draft

    let finalAction = result.action;
    if (finalAction === 'CLARIFY') {
      const clarifyCount = await this.escalationService.clarifyCount(tenantId, conversationId);
      if (clarifyCount >= 1) finalAction = 'ESCALATE'; // already asked once -- don't ask forever
    }

    const kbCoverageNote = result.retrievedChunks.length === 0
      ? 'The knowledge base had no relevant content for this question.'
      : `The knowledge base had ${result.retrievedChunks.length} potentially relevant chunk(s), but Verz was not confident enough to answer directly.`;

    if (aiMode === 'SUGGESTION') {
      // Never auto-send in this mode -- always surface whatever Verz produced,
      // labeled with action/verification so the agent knows how much to trust it.
      const log = await this.aiLogsService.create({
        tenantId, conversationId, contactId: contact.id,
        customerMessage: content, aiResponse: result.response, status: 'SUGGESTED',
        confidenceScore: result.confidence, responseTimeMs: result.responseTimeMs,
        sources: result.sources, action: finalAction,
        verificationPassed: result.verificationPassed, verificationFailReason: result.verificationFailReason,
        unverifiedDetail: result.unverifiedDetail,
      }) as { id: string };

      this.realtimeService.emitAiSuggestion(tenantId, conversationId, {
        logId: log.id, response: result.response, confidence: result.confidence,
      });

      if (finalAction === 'ESCALATE') {
        const reason: EscalationReason = !result.verificationPassed ? 'verification_failed' : 'low_confidence';
        await this.escalationService.postHandoffNote({
          tenantId, conversationId,
          verzAgentId: (await this.aiResponderService.findOrCreateVerzAgent(tenantId).catch(() => null))?.id ?? contact.id,
          customerQuestion: content, reason, draftReply: result.response, kbCoverageNote,
        }).catch(() => null);
      }
      return;
    }

    // --- AUTO_REPLY ---
    const shouldAi = await this.aiResponderService.shouldRespond(tenantId).catch(() => false);
    if (!shouldAi) return;

    const threshold = aiSettings?.aiConfidenceThreshold ?? 75;
    const canAutoSend = finalAction === 'ANSWER' && result.verificationPassed && (result.confidence ?? 0) >= threshold;

    if (!canAutoSend) {
      const reason: EscalationReason = finalAction === 'CLARIFY' ? 'clarify_exhausted'
        : !result.verificationPassed ? 'verification_failed' : 'low_confidence';
      await this.aiLogsService.create({
        tenantId, conversationId, contactId: contact.id,
        customerMessage: content, aiResponse: result.response, status: 'ESCALATED',
        confidenceScore: result.confidence, responseTimeMs: result.responseTimeMs,
        sources: result.sources, action: finalAction,
        verificationPassed: result.verificationPassed, verificationFailReason: result.verificationFailReason,
        unverifiedDetail: result.unverifiedDetail, escalationReason: reason,
      });
      await this.escalateConversation({
        tenantId, conversationId, contact, customerQuestion: content, reason,
        draftReply: result.response, aiMode, holdingMessage: aiSettings?.aiHoldingMessage ?? null, assignedTo,
      });
      return; // no credit deducted -- nothing was sent to the customer
    }

    const verzAgent = await this.aiResponderService.findOrCreateVerzAgent(tenantId).catch(() => null);

    // Credit integrity: race-safe conditional decrement (the `gt: 0` guard means
    // concurrent sends can never take the balance negative), zero credits falls
    // back to a SUGGESTION instead of a silent shutdown.
    const decremented = await this.prisma.tenant.updateMany({
      where: { id: tenantId, aiCredits: { gt: 0 } },
      data: { aiCredits: { decrement: 1 } },
    });
    if (decremented.count === 0) {
      const log = await this.aiLogsService.create({
        tenantId, conversationId, contactId: contact.id,
        customerMessage: content, aiResponse: result.response, status: 'SUGGESTED',
        confidenceScore: result.confidence, responseTimeMs: result.responseTimeMs,
        sources: result.sources, action: finalAction, verificationPassed: result.verificationPassed,
      }) as { id: string };
      this.realtimeService.emitAiSuggestion(tenantId, conversationId, {
        logId: log.id, response: result.response, confidence: result.confidence,
      });
      return;
    }

    const waId = await this.whatsappService.sendTextMessage(tenantId, contact.phone, result.response).catch(() => null);
    if (!waId) {
      // Send failed after the credit was already deducted -- refund it.
      await this.prisma.tenant.update({ where: { id: tenantId }, data: { aiCredits: { increment: 1 } } }).catch(() => null);
      return;
    }

    await this.aiLogsService.create({
      tenantId, conversationId, contactId: contact.id,
      customerMessage: content, aiResponse: result.response, status: 'AUTO_SENT',
      confidenceScore: result.confidence, responseTimeMs: result.responseTimeMs,
      sources: result.sources, action: finalAction, verificationPassed: result.verificationPassed,
    });

    const aiMessage = await this.prisma.message.create({
      data: {
        tenantId, conversationId, contactId: contact.id,
        senderId: verzAgent?.id ?? null,
        direction: 'OUTBOUND' as const, type: 'TEXT' as const, status: 'SENT' as const,
        content: result.response,
        metadata: { aiGenerated: true },
      },
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
    });

    if (verzAgent && !assignedTo) {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { assignedToId: verzAgent.id, status: 'OPEN' },
      });
      this.realtimeService.emitConversationUpdated(tenantId, conversationId, {
        assignedTo: { id: verzAgent.id, name: verzAgent.name, avatarUrl: verzAgent.avatarUrl, isAiAgent: true },
        status: 'OPEN',
      });
    }
    this.realtimeService.emitNewMessage(tenantId, conversationId, aiMessage);
  }

  /**
   * Hands a conversation off to a human: posts an internal note summarizing
   * why (so an agent never has to reconstruct context by scrolling), marks
   * the conversation REQUESTED so it surfaces in the human queue, and -- for
   * AUTO_REPLY tenants with a configured holding message -- sends it to the
   * customer so they aren't left in silence.
   */
  private async escalateConversation(opts: {
    tenantId: string;
    conversationId: string;
    contact: { id: string; phone: string };
    customerQuestion: string;
    reason: EscalationReason;
    draftReply: string | null;
    aiMode: 'SUGGESTION' | 'AUTO_REPLY';
    holdingMessage: string | null;
    assignedTo: { id: string; isAiAgent?: boolean } | null;
  }) {
    const verzAgent = await this.aiResponderService.findOrCreateVerzAgent(opts.tenantId).catch(() => null);

    if (verzAgent) {
      await this.escalationService.postHandoffNote({
        tenantId: opts.tenantId,
        conversationId: opts.conversationId,
        verzAgentId: verzAgent.id,
        customerQuestion: opts.customerQuestion,
        reason: opts.reason,
        draftReply: opts.draftReply,
        kbCoverageNote: '',
      }).catch(() => null);
    }

    if (!opts.assignedTo) {
      await this.prisma.conversation.update({
        where: { id: opts.conversationId },
        data: { status: 'REQUESTED' },
      }).catch(() => null);
      this.realtimeService.emitConversationUpdated(opts.tenantId, opts.conversationId, { status: 'REQUESTED' });
    }

    if (opts.aiMode === 'AUTO_REPLY' && opts.holdingMessage) {
      const waId = await this.whatsappService.sendTextMessage(opts.tenantId, opts.contact.phone, opts.holdingMessage).catch(() => null);
      if (waId) {
        const holdingMsg = await this.prisma.message.create({
          data: {
            tenantId: opts.tenantId, conversationId: opts.conversationId, contactId: opts.contact.id,
            senderId: verzAgent?.id ?? null,
            direction: 'OUTBOUND' as const, type: 'TEXT' as const, status: 'SENT' as const,
            content: opts.holdingMessage,
            metadata: { aiGenerated: true, isEscalationHolding: true },
          },
          include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
        });
        this.realtimeService.emitNewMessage(opts.tenantId, opts.conversationId, holdingMsg);
      }
    }
  }

  private async runBotFlow(tenantId: string, conversationId: string, contact: { id: string; phone: string }, rawNodes: FlowNode[] | Record<string, unknown>) {
    if (!rawNodes) return;

    // Support both simple FlowNode[] and ReactFlow {nodes,edges} format
    type ExecNode = { id: string; type: string; data: Record<string, unknown> };
    let execNodes: ExecNode[];
    const edgeMap = new Map<string, string>(); // source nodeId -> target nodeId (first edge only)

    if (!Array.isArray(rawNodes) && typeof rawNodes === 'object' && 'nodes' in rawNodes) {
      const rf = rawNodes as { nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>; edges: Array<{ source: string; target: string }> };
      execNodes = rf.nodes ?? [];
      for (const e of (rf.edges ?? [])) {
        if (!edgeMap.has(e.source)) edgeMap.set(e.source, e.target);
      }
    } else {
      const simple = rawNodes as FlowNode[];
      execNodes = simple.map(n => ({ id: n.id, type: n.type, data: { content: n.content, mediaUrl: n.mediaUrl, delaySeconds: n.delaySeconds } }));
      for (const n of simple) { if (n.nextNodeId) edgeMap.set(n.id, n.nextNodeId); }
    }

    if (!execNodes.length) return;

    // Find the trigger/start node and begin from its first successor
    const allTargets = new Set(edgeMap.values());
    const startNode = execNodes.find(n => n.type === 'start') ?? execNodes.find(n => !allTargets.has(n.id));
    if (!startNode) return;

    let nodeId: string | undefined = edgeMap.get(startNode.id);
    const visited = new Set<string>();

    while (nodeId && !visited.has(nodeId)) {
      visited.add(nodeId);
      const node = execNodes.find(n => n.id === nodeId);
      if (!node || node.type === 'end') break;

      try {
        const content = (node.data.content as string | undefined) ?? undefined;
        const mediaUrl = (node.data.mediaUrl as string | undefined) ?? undefined;
        const delaySec = node.data.delaySeconds as number | undefined;

        if (node.type === 'text' && content) {
          const msg = await this.prisma.message.create({
            data: { tenantId, conversationId, contactId: contact.id, direction: MessageDirection.OUTBOUND, type: MessageType.TEXT, status: MessageStatus.QUEUED, content },
          });
          const waId = await this.whatsappService.sendTextMessage(tenantId, contact.phone, content).catch(() => null);
          const updated = await this.prisma.message.update({ where: { id: msg.id }, data: { whatsappMessageId: waId ?? undefined, status: waId ? MessageStatus.SENT : MessageStatus.FAILED, sentAt: waId ? new Date() : undefined } });
          this.realtimeService.emitNewMessage(tenantId, conversationId, updated as unknown as Record<string, unknown>);
        } else if (node.type === 'image' && mediaUrl) {
          const msg = await this.prisma.message.create({
            data: { tenantId, conversationId, contactId: contact.id, direction: MessageDirection.OUTBOUND, type: MessageType.IMAGE, status: MessageStatus.QUEUED, mediaUrl, mediaCaption: content ?? null },
          });
          const waId = await this.whatsappService.sendMediaMessage(tenantId, contact.phone, 'image', mediaUrl, content).catch(() => null);
          const updated = await this.prisma.message.update({ where: { id: msg.id }, data: { whatsappMessageId: waId ?? undefined, status: waId ? MessageStatus.SENT : MessageStatus.FAILED, sentAt: waId ? new Date() : undefined } });
          this.realtimeService.emitNewMessage(tenantId, conversationId, updated as unknown as Record<string, unknown>);
        } else if (node.type === 'delay' && delaySec) {
          await new Promise(r => setTimeout(r, Math.min(delaySec * 1000, 10000)));
        }
      } catch { /* continue to next node on error */ }

      nodeId = edgeMap.get(nodeId);
    }
  }

  async addReaction(tenantId: string, conversationId: string, messageId: string, userId: string, emoji: string) {
    const reaction = await this.prisma.messageReaction.upsert({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
      create: { messageId, tenantId, userId, emoji },
      update: {},
    });

    // Send reaction to WhatsApp — look up the message's whatsapp ID and the contact's phone
    const msg = await this.prisma.message.findFirst({
      where: { id: messageId, tenantId },
      include: { conversation: { include: { contact: true } } },
    });
    if (msg?.whatsappMessageId && msg.conversation?.contact?.phone) {
      await this.whatsappService.sendReaction(tenantId, msg.conversation.contact.phone, msg.whatsappMessageId, emoji).catch(() => null);
    }

    const reactions = await this.prisma.messageReaction.findMany({
      where: { messageId },
      select: { id: true, emoji: true, userId: true },
    });
    this.realtimeService.emitReactionUpdated(tenantId, conversationId, messageId, reactions);

    return reaction;
  }

  async removeReaction(tenantId: string, messageId: string, userId: string, emoji: string) {
    await this.prisma.messageReaction.deleteMany({
      where: { messageId, userId, emoji },
    });

    // Send empty emoji to remove reaction on WhatsApp
    const msg = await this.prisma.message.findFirst({
      where: { id: messageId, tenantId },
      include: { conversation: { include: { contact: true } } },
    });
    if (msg?.whatsappMessageId && msg.conversation?.contact?.phone) {
      await this.whatsappService.sendReaction(tenantId, msg.conversation.contact.phone, msg.whatsappMessageId, '').catch(() => null);
    }

    const reactions = await this.prisma.messageReaction.findMany({
      where: { messageId },
      select: { id: true, emoji: true, userId: true },
    });
    if (msg?.conversationId) {
      this.realtimeService.emitReactionUpdated(tenantId, msg.conversationId, messageId, reactions);
    }

    return { success: true };
  }

  async toggleStar(tenantId: string, conversationId: string, messageId: string) {
    const msg = await this.prisma.message.findFirst({ where: { id: messageId, tenantId, conversationId } });
    if (!msg) return { success: false };
    return this.prisma.message.update({
      where: { id: messageId },
      data: { isStarred: !msg.isStarred },
    });
  }

  async togglePin(tenantId: string, conversationId: string, messageId: string, userId: string) {
    const existing = await this.prisma.pinnedMessage.findUnique({
      where: { conversationId_messageId: { conversationId, messageId } },
    });
    if (existing) {
      await this.prisma.pinnedMessage.delete({ where: { id: existing.id } });
      await this.prisma.message.update({ where: { id: messageId }, data: { isPinned: false } });
      return { pinned: false };
    }
    await this.prisma.pinnedMessage.create({
      data: { tenantId, conversationId, messageId, pinnedById: userId },
    });
    await this.prisma.message.update({ where: { id: messageId }, data: { isPinned: true } });
    return { pinned: true };
  }

  async updateStatus(
    whatsappMessageId: string,
    status: MessageStatus,
    tenantId: string,
    errors?: Array<{ code: number; title: string }>,
  ) {
    const message = await this.prisma.message.findFirst({
      where: { whatsappMessageId, tenantId },
    });
    if (!message) return;

    const updateData: Record<string, unknown> = { status };
    if (status === MessageStatus.DELIVERED) updateData['deliveredAt'] = new Date();
    if (status === MessageStatus.READ) updateData['readAt'] = new Date();
    if (status === MessageStatus.FAILED) {
      updateData['failedAt'] = new Date();
      if (errors?.[0]) {
        updateData['errorCode'] = errors[0].code;
        updateData['failureReason'] = errors[0].title;
      }
    }

    await this.prisma.message.update({ where: { id: message.id }, data: updateData });

    // Propagate delivery/read/failed status back to campaign stats
    if (status === MessageStatus.DELIVERED || status === MessageStatus.READ || status === MessageStatus.FAILED) {
      const recipient = await this.prisma.campaignRecipient.findFirst({
        where: { messageId: message.id },
      });
      if (recipient) {
        if (status === MessageStatus.DELIVERED && recipient.status === 'SENT') {
          await this.prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: 'DELIVERED' } });
          await this.prisma.campaign.update({ where: { id: recipient.campaignId }, data: { deliveredCount: { increment: 1 } } });
        } else if (status === MessageStatus.READ && (recipient.status === 'SENT' || recipient.status === 'DELIVERED')) {
          const wasDelivered = recipient.status === 'DELIVERED';
          await this.prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: 'READ' } });
          await this.prisma.campaign.update({
            where: { id: recipient.campaignId },
            data: {
              readCount: { increment: 1 },
              ...(!wasDelivered ? { deliveredCount: { increment: 1 } } : {}),
            },
          });
        } else if (status === MessageStatus.FAILED && recipient.status !== 'FAILED') {
          await this.prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: {
              status: 'FAILED',
              ...(errors?.[0] && { errorCode: errors[0].code, errorMessage: errors[0].title }),
            },
          });
          await this.prisma.campaign.update({ where: { id: recipient.campaignId }, data: { failedCount: { increment: 1 } } });
        }
      }
    }

    this.realtimeService.emitMessageStatus(tenantId, {
      messageId: message.id,
      whatsappMessageId,
      status,
      conversationId: message.conversationId,
    });
  }

  async globalSearch(tenantId: string, q: string, page = 1, limit = 20) {
    const term = q.trim();
    if (!term) return { data: [], meta: { total: 0, page, limit } };

    const skip = getPaginationSkip(page, limit);
    const where = {
      tenantId,
      type: { in: ['TEXT', 'NOTE', 'TEMPLATE'] as never[] },
      content: { contains: term, mode: 'insensitive' as const },
    };

    const [data, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          content: true,
          type: true,
          direction: true,
          createdAt: true,
          conversationId: true,
          contact: { select: { id: true, name: true, phone: true, avatarUrl: true } },
          sender: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      this.prisma.message.count({ where }),
    ]);

    return { data, meta: { total: Number(total), page, limit, pages: Math.ceil(Number(total) / limit) } };
  }
}
