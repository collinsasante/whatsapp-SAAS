import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ContactsService } from '../contacts/contacts.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SendMessageDto } from './dto/message.dto';
import { MessageType, MessageDirection, MessageStatus } from '@whatsapp-platform/shared-types';
import { buildPaginationMeta, getPaginationSkip } from '@whatsapp-platform/shared-utils';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private whatsappService: WhatsAppService,
    private conversationsService: ConversationsService,
    private contactsService: ContactsService,
    private realtimeService: RealtimeService,
  ) {}

  async sendMessage(tenantId: string, conversationId: string, senderId: string, dto: SendMessageDto) {
    const conversation = await this.conversationsService.findOne(tenantId, conversationId);
    const contact = await this.contactsService.findOne(tenantId, conversation.contactId);

    if (contact.isBlocked || contact.optedOut) {
      throw new NotFoundException('Cannot send message to this contact');
    }

    const message = await this.prisma.message.create({
      data: {
        tenantId,
        conversationId,
        contactId: contact.id,
        senderId,
        direction: MessageDirection.OUTBOUND,
        type: (dto.type as MessageType) ?? MessageType.TEXT,
        status: MessageStatus.QUEUED,
        content: dto.content,
        mediaUrl: dto.mediaUrl,
        mediaCaption: dto.mediaCaption,
        templateId: dto.templateId,
        templateVariables: dto.templateVariables ?? undefined,
      },
    });

    let whatsappMessageId: string | undefined;

    try {
      if (dto.type === MessageType.TEXT || !dto.type) {
        whatsappMessageId = await this.whatsappService.sendTextMessage(tenantId, contact.phone, dto.content!);
      } else if (([MessageType.IMAGE, MessageType.VIDEO, MessageType.AUDIO, MessageType.DOCUMENT] as MessageType[]).includes(dto.type as MessageType)) {
        whatsappMessageId = await this.whatsappService.sendMediaMessage(
          tenantId,
          contact.phone,
          dto.type.toLowerCase(),
          dto.mediaUrl!,
          dto.mediaCaption,
        );
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

      const updatedMessage = await this.prisma.message.findUnique({ where: { id: message.id } });
      this.realtimeService.emitNewMessage(tenantId, conversationId, updatedMessage!);

      return updatedMessage;
    } catch (error) {
      await this.prisma.message.update({
        where: { id: message.id },
        data: {
          status: MessageStatus.FAILED,
          failedAt: new Date(),
          failureReason: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      throw error;
    }
  }

  async findByConversation(tenantId: string, conversationId: string, page = 1, limit = 50) {
    const conversation = await this.conversationsService.findOne(tenantId, conversationId);
    const skip = getPaginationSkip(page, limit);

    const [data, total] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
        include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
      }),
      this.prisma.message.count({ where: { conversationId: conversation.id } }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async handleInbound(tenantId: string, waMessage: {
    id: string;
    from: string;
    timestamp: string;
    type: string;
    text?: { body: string };
    image?: { id: string; mime_type: string; sha256: string; caption?: string };
    video?: { id: string; mime_type: string };
    audio?: { id: string; mime_type: string };
    document?: { id: string; mime_type: string; filename?: string };
  }) {
    const contact = await this.contactsService.findOrCreate(tenantId, waMessage.from);
    const conversation = await this.conversationsService.findOrCreate(tenantId, contact.id);

    let content: string | undefined;
    let mediaUrl: string | undefined;
    let mediaType: string | undefined;
    let mediaCaption: string | undefined;

    const msgType = waMessage.type.toUpperCase() as MessageType;

    if (waMessage.text) content = waMessage.text.body;

    const mediaId = waMessage.image?.id ?? waMessage.video?.id ?? waMessage.audio?.id ?? waMessage.document?.id;
    if (mediaId) {
      if (waMessage.image) { mediaType = waMessage.image.mime_type; mediaCaption = waMessage.image.caption; }
      else if (waMessage.video) { mediaType = waMessage.video.mime_type; }
      else if (waMessage.audio) { mediaType = waMessage.audio.mime_type; }
      else if (waMessage.document) { mediaType = waMessage.document.mime_type; mediaCaption = waMessage.document.filename; }
      const fetchedUrl = await this.whatsappService.getMediaUrl(tenantId, mediaId);
      if (fetchedUrl) mediaUrl = fetchedUrl;
    }

    const message = await this.prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        contactId: contact.id,
        whatsappMessageId: waMessage.id,
        direction: MessageDirection.INBOUND,
        type: msgType,
        status: MessageStatus.DELIVERED,
        content,
        mediaUrl,
        mediaType,
        mediaCaption,
        deliveredAt: new Date(),
      },
    });

    await this.conversationsService.incrementUnread(conversation.id);
    this.realtimeService.emitNewMessage(tenantId, conversation.id, message);
    this.realtimeService.emitConversationUpdated(tenantId, conversation.id, {
      id: conversation.id,
      unreadCount: (conversation.unreadCount ?? 0) + 1,
      lastMessageAt: message.createdAt,
      contact: (conversation as Record<string, unknown>)['contact'],
      status: conversation.status,
      assignedTo: (conversation as Record<string, unknown>)['assignedTo'],
      labels: (conversation as Record<string, unknown>)['labels'] ?? [],
    });

    await this.whatsappService.markMessageRead(tenantId, waMessage.id).catch(() => null);

    return message;
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
