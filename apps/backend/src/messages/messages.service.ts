import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ContactsService } from '../contacts/contacts.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StorageService } from '../media/storage.service';
import { ChatbotFlowsService, FlowNode } from '../chatbot-flows/chatbot-flows.service';
import { SendMessageDto } from './dto/message.dto';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { MessageType, MessageDirection, MessageStatus, ActivityAction } from '@whatsapp-platform/shared-types';
import { buildPaginationMeta, getPaginationSkip } from '@whatsapp-platform/shared-utils';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private whatsappService: WhatsAppService,
    private conversationsService: ConversationsService,
    private contactsService: ContactsService,
    private realtimeService: RealtimeService,
    private storageService: StorageService,
    private chatbotFlowsService: ChatbotFlowsService,
    private activityLogService: ActivityLogService,
  ) {}

  async sendMessage(tenantId: string, conversationId: string, senderId: string, dto: SendMessageDto) {
    const conversation = await this.conversationsService.findOne(tenantId, conversationId);
    const contact = await this.contactsService.findOne(tenantId, conversation.contactId);

    if (contact.isBlocked || contact.optedOut) {
      throw new NotFoundException('Cannot send message to this contact');
    }

    // Block other agents from messaging when someone has intervened
    if (conversation.status === 'INTERVENED' && (conversation as unknown as { assignedToId?: string | null }).assignedToId !== senderId) {
      throw new ForbiddenException('This conversation has been taken over by another agent');
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
        content: dto.content,
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
      replyToWaMessageId = replyToMsg?.whatsappMessageId ?? undefined;
    }

    let whatsappMessageId: string | undefined;

    try {
      if (dto.type === MessageType.TEXT || !dto.type) {
        whatsappMessageId = await this.whatsappService.sendTextMessage(tenantId, contact.phone, dto.content!, replyToWaMessageId);
      } else if (([MessageType.IMAGE, MessageType.VIDEO, MessageType.AUDIO, MessageType.DOCUMENT] as MessageType[]).includes(dto.type as MessageType)) {
        // For audio/video upload the file to Meta first to get a media_id (avoids format rejection)
        if (dto.mediaUrl && (dto.type === MessageType.AUDIO || dto.type === MessageType.VIDEO)) {
          try {
            // Prefer direct S3 read (avoids nginx loopback + rate limits)
            let mediaBuffer: Buffer | null = null;
            let mimeType = dto.type === MessageType.AUDIO ? 'audio/ogg' : 'video/mp4';

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
              // Fallback: HTTP download (for non-proxy URLs)
              const dlRes = await axios.get<ArrayBuffer>(dto.mediaUrl, { responseType: 'arraybuffer', timeout: 120_000 });
              mediaBuffer = Buffer.from(dlRes.data);
              mimeType = (dlRes.headers['content-type'] as string | undefined) ?? mimeType;
            }

            const ext = mimeType.split('/')[1]?.split(';')[0] ?? (dto.type === MessageType.AUDIO ? 'ogg' : 'mp4');
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
        } else {
          whatsappMessageId = await this.whatsappService.sendMediaMessage(
            tenantId,
            contact.phone,
            dto.type.toLowerCase(),
            dto.mediaUrl!,
            dto.mediaCaption,
            replyToWaMessageId,
          );
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

  async findByConversation(tenantId: string, conversationId: string, page = 1, limit = 50, search?: string) {
    const conversation = await this.conversationsService.findOne(tenantId, conversationId);
    const skip = getPaginationSkip(page, limit);

    const where = search?.trim()
      ? { conversationId: conversation.id, content: { contains: search.trim(), mode: 'insensitive' as const } }
      : { conversationId: conversation.id };

    const [data, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take: search?.trim() ? 200 : limit,
        include: {
          sender: { select: { id: true, name: true, avatarUrl: true } },
          replyTo: { select: { id: true, content: true, type: true, direction: true, mediaCaption: true } },
          reactions: { select: { id: true, emoji: true, userId: true } },
        },
      }),
      this.prisma.message.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async handleInbound(tenantId: string, waMessage: {
    id: string;
    from: string;
    timestamp: string;
    type: string;
    context?: { id: string; from?: string };
    text?: { body: string };
    image?: { id: string; mime_type: string; sha256: string; caption?: string };
    video?: { id: string; mime_type: string };
    audio?: { id: string; mime_type: string };
    document?: { id: string; mime_type: string; filename?: string };
    sticker?: { id: string; mime_type: string; animated?: boolean };
    reaction?: { message_id: string; emoji: string };
    location?: { latitude: number; longitude: number; name?: string; address?: string };
    contacts?: Array<{ name: { formatted_name: string }; phones?: Array<{ phone: string }> }>;
    interactive?: { type: 'list_reply' | 'button_reply'; list_reply?: { id: string; title: string }; button_reply?: { id: string; title: string } };
  }, profileName?: string) {
    // Idempotency: skip if this WA message was already processed for this tenant.
    // Protects against Meta webhook retries AND fan-out re-delivery.
    const alreadyProcessed = await this.prisma.message.findFirst({
      where: { whatsappMessageId: waMessage.id, tenantId },
      select: { id: true },
    });
    if (alreadyProcessed) return alreadyProcessed;

    const contact = await this.contactsService.findOrCreate(tenantId, waMessage.from, profileName);
    const conversation = await this.conversationsService.findOrCreate(tenantId, contact.id);

    // Migrate any legacy OPEN conversations to REQUESTING on next inbound message
    if (conversation.status === 'OPEN') {
      await this.conversationsService.request(tenantId, conversation.id);
    }

    // Handle customer-deleted message — mark it deleted in our DB
    if (waMessage.type === 'deleted') {
      return null;
    }

    // Handle CSAT survey reply (interactive list_reply with csat_N id)
    if (waMessage.type === 'interactive' && waMessage.interactive) {
      const replyId = waMessage.interactive.list_reply?.id ?? waMessage.interactive.button_reply?.id ?? '';
      if (replyId.startsWith('csat_')) {
        const score = parseInt(replyId.replace('csat_', ''), 10);
        if (score >= 1 && score <= 5) {
          // Save score on conversation
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { csatScore: score, csatSubmittedAt: new Date() } as { csatScore: number; csatSubmittedAt: Date },
          });
          // Log as activity (renders inline in chat)
          void this.activityLogService.log({
            tenantId,
            action: ActivityAction.SURVEY_RESPONSE,
            conversationId: conversation.id,
            contactId: contact.id,
            metadata: { score },
          });
          // Mark read + send thank-you
          await this.whatsappService.markMessageRead(tenantId, waMessage.id).catch(() => null);
          await this.whatsappService.sendTextMessage(tenantId, contact.phone, 'Thank you for rating this chat! ⭐ Your feedback helps us improve.').catch(() => null);
          return null;
        }
      }
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
      await this.whatsappService.markMessageRead(tenantId, waMessage.id).catch(() => null);
      return null;
    }

    let content: string | undefined;
    let mediaUrl: string | undefined;
    let mediaType: string | undefined;
    let mediaCaption: string | undefined;
    const messageMetadata: Record<string, unknown> = {};

    const msgType = waMessage.type.toUpperCase() as MessageType;

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

    // Resolve replyToId from WhatsApp context field
    let replyToId: string | null = null;
    if (waMessage.context?.id) {
      const contextMsg = await this.prisma.message.findFirst({
        where: { whatsappMessageId: waMessage.context.id, tenantId },
        select: { id: true },
      });
      replyToId = contextMsg?.id ?? null;
    }

    const message = await this.prisma.message.create({
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
    });

    await this.conversationsService.incrementUnread(conversation.id);
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

    await this.whatsappService.markMessageRead(tenantId, waMessage.id).catch(() => null);

    // Trigger chatbot flow if one matches this message
    if (content) {
      const flow = await this.chatbotFlowsService.findMatchingFlow(tenantId, content);
      if (flow) {
        void this.runBotFlow(tenantId, conversation.id, { id: contact.id, phone: contact.phone }, flow.nodes as unknown as FlowNode[]);
      }
    }

    return message;
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

  async updateStatus(whatsappMessageId: string, status: MessageStatus, tenantId: string) {
    const message = await this.prisma.message.findFirst({
      where: { whatsappMessageId, tenantId },
    });
    if (!message) return;

    const updateData: Record<string, unknown> = { status };
    if (status === MessageStatus.DELIVERED) updateData['deliveredAt'] = new Date();
    if (status === MessageStatus.READ) updateData['readAt'] = new Date();
    if (status === MessageStatus.FAILED) updateData['failedAt'] = new Date();

    await this.prisma.message.update({ where: { id: message.id }, data: updateData });

    this.realtimeService.emitMessageStatus(tenantId, {
      messageId: message.id,
      whatsappMessageId,
      status,
      conversationId: message.conversationId,
    });
  }
}
