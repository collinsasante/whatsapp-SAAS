import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, Inject, Optional, forwardRef } from '@nestjs/common';
import { DigitalSelfLearningTrigger } from '../digital-self/digital-self-learning.trigger';
import axios from 'axios';
import { Prisma, Message } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { FacebookMessengerService } from '../facebook-messenger/facebook-messenger.service';
import { WhatsAppWebService } from '../whatsapp-web/whatsapp-web.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ContactsService } from '../contacts/contacts.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StorageService } from '../media/storage.service';
import { ChatbotFlowsService, FlowNode } from '../chatbot-flows/chatbot-flows.service';
import { AiResponderService } from '../ai/ai-responder.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { AiLogsService } from '../ai-logs/ai-logs.service';
import { CommerceAiService } from '../commerce/ai/commerce-ai.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { AiAgentsService } from '../ai-core/agents/ai-agents.service';
import { VerzAiPipelineService } from '../ai-core/pipeline/verz-ai-pipeline.service';
import { AiExecutionsService } from '../ai-core/executions/ai-executions.service';
import { LeadsService } from '../leads/leads.service';
import { ToolCallTrace } from '../ai-core/tools/tool-calling.service';
import { ToolSideEffect } from '../ai-core/tools/tool-registry.types';
import { ConversationStateService } from '../conversations/conversation-state.service';
import { AiCreditsService } from '../ai-core/credits/ai-credits.service';
import { SendMessageDto } from './dto/message.dto';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { notify } from '../common/notifier';
import { MessageType, MessageDirection, MessageStatus, ActivityAction, UserRole } from '@whatsapp-platform/shared-types';
import { shouldApplyStatus } from './message-status.util';
import { isMetaPlayableAudio, isOggBuffer, isWebmBuffer, transcodeToM4a, transcodeWebmToOgg } from '../common/media/audio.util';
import type { OutboundFile } from '../facebook-messenger/facebook-messenger.service';
import { channelHasCustomerServiceWindow, isCustomerServiceWindowOpen } from './customer-service-window.util';
import { buildPaginationMeta, getPaginationSkip, interpolateTemplate, isSimulatedPhone, SimulatedRecipientError } from '@whatsapp-platform/shared-utils';
import { isAiAllowedForContact } from './ai-contact-restriction.util';
import { HANDOFF_FAILED_TEXT, HUMAN_HANDOFF_REPLY, PROVIDER_FAILURE_FALLBACK_TEXT } from '../ai-core/prompts/escalation-messages.util';
import { isUnsupportedFollowUpPromise } from '../ai-core/pipeline/follow-up-promise.util';
import { buildLegacyTrace, describeProviderError, LegacyCallObservation, readProviderUsage } from './legacy-ai-execution.util';
import { detectHumanRequest } from '../ai-core/pipeline/escalation-detector.util';
import { isAgentAway } from './ai-takeover.util';

/**
 * Verz-AI unification, Phase C: the single result shape every AI generator
 * (Commerce, Verz-AI v2 pipeline, legacy responder) is normalized into before the
 * shared SUGGESTION/AUTO_REPLY post-processing runs -- see generateAiReply below.
 * `toolTrace` is populated only by the Commerce path (for the eval harness); every
 * other generator leaves it undefined.
 */
interface UnifiedAiResult {
  response: string;
  confidence: number | null;
  blocked: boolean;
  executionId: string | null;
  shouldEscalate?: boolean;
  toolTrace?: ToolCallTrace[];
  /** Verz-AI unification, Phase G: side effects (e.g. send_product_image) a tool
   * call this turn triggered -- deliverMedia() is responsible for actually
   * sending them. Only ever populated by tool-calling paths (Commerce, v2
   * pipeline); the legacy responder has no tools, always undefined here. */
  mediaToSend?: ToolSideEffect[];
}

/** Conservative starting estimate for the legacy (untracked) AI responder path --
 * see generateAiReply's legacy branch. Roughly matches what a typical short
 * RESPONDER exchange costs under real token-based metering elsewhere; tune via
 * the admin pricing API alongside AiPricingConfig.creditsPerUsd once real usage
 * data exists, not a final business decision baked into code. */
const LEGACY_RESPONDER_FLAT_CREDIT_COST = 2;

/** Messenger and Instagram replies are plain text with no WhatsApp *bold* markup; everything else keeps WhatsApp formatting. */
export function aiChannelType(type: string | null | undefined): 'WHATSAPP' | 'FACEBOOK_MESSENGER' {
  return type === 'FACEBOOK_MESSENGER' || type === 'INSTAGRAM' ? 'FACEBOOK_MESSENGER' : 'WHATSAPP';
}

// Messenger's Send/Receive API attachment `type` values -- 'file' covers
// documents generically (no separate 'document' type the way WhatsApp has).
const MESSENGER_ATTACHMENT_TYPE_MAP: Record<string, MessageType> = {
  image: MessageType.IMAGE,
  video: MessageType.VIDEO,
  audio: MessageType.AUDIO,
  file: MessageType.DOCUMENT,
};
const INSTAGRAM_LINK_LABELS: Record<string, string> = {
  share: 'Shared a post',
  story_mention: 'Mentioned you in a story',
  ig_reel: 'Shared a reel',
  reel: 'Shared a reel',
};
const MESSENGER_ATTACHMENT_FALLBACK_MIME: Record<string, string> = {
  image: 'image/jpeg',
  video: 'video/mp4',
  audio: 'audio/mpeg',
  file: 'application/octet-stream',
};

// Baileys' own media-message field names -- extracted by apps/whatsapp-web
// before the event ever reaches here (see session-manager.ts).
const WHATSAPP_WEB_MEDIA_TYPE_MAP: Record<string, MessageType> = {
  image: MessageType.IMAGE,
  video: MessageType.VIDEO,
  audio: MessageType.AUDIO,
  document: MessageType.DOCUMENT,
};

// Total worst-case wait ~1.7s: covers the gap between provider accept and the DB write of its id.
/**
 * How a simulated (AI Test Chat) message is marked on its row. The message is never handed to a provider, so it must not read as
 * sent: the status stays QUEUED, it gets no provider id and no sentAt, and this marker says why. (MessageStatus has no
 * "simulated" value; adding one needs a reviewed migration, and the marker keeps that choice open: change it in one place.)
 */
const SIMULATED_MESSAGE_METADATA = { simulated: true } as const;

const CLIENT_SEND_DEDUPE_TTL_MS = 10 * 60 * 1000;

/**
 * After the AI could not answer because the provider failed and a handoff was requested, the customer has already been told so.
 * Within this window a further provider failure on the same conversation sends nothing more (see handleAiAutoReply), instead of
 * repeating the same apology and handoff request on every message the customer writes.
 */
const PROVIDER_FAILURE_FALLBACK_COOLDOWN_MS = 15 * 60_000;
export const RECEIPT_LOOKUP_RETRY_DELAYS_MS: readonly number[] = [150, 400, 1200];

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  // Verz-AI unification, Phase M: two inbound messages from the same customer
  // arriving close together used to launch two fully independent, unsynchronized
  // AI generations for the same conversation -- each re-reading conversation
  // history and aiState at its own start, both able to self-assign the
  // conversation and both able to send a WhatsApp message, racing on shared
  // state. This map chains each conversation's AI turns strictly one after another.
  // Known limitation: this is in-process only -- correct for the current single
  // backend-replica-per-environment deployment, but would need a Redis-backed lock
  // (no raw Redis client is wired into this app today, only BullMQ) if the backend
  // is ever horizontally scaled to multiple replicas.
  private readonly conversationAiLocks = new Map<string, Promise<void>>();

  private runExclusiveForConversation(conversationId: string, fn: () => Promise<void>): Promise<void> {
    const previous = this.conversationAiLocks.get(conversationId) ?? Promise.resolve();
    const next = previous.then(fn, fn).finally(() => {
      if (this.conversationAiLocks.get(conversationId) === next) this.conversationAiLocks.delete(conversationId);
    });
    this.conversationAiLocks.set(conversationId, next);
    return next;
  }

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
    private knowledgeBaseService: KnowledgeBaseService,
    private aiLogsService: AiLogsService,
    private commerceAiService: CommerceAiService,
    private featureFlagsService: FeatureFlagsService,
    private aiAgentsService: AiAgentsService,
    private verzAiPipeline: VerzAiPipelineService,
    private aiExecutionsService: AiExecutionsService,
    private leadsService: LeadsService,
    private aiCreditsService: AiCreditsService,
    private conversationState: ConversationStateService,
    @Inject(forwardRef(() => FacebookMessengerService)) private facebookMessengerService: FacebookMessengerService,
    @Inject(forwardRef(() => WhatsAppWebService)) private whatsAppWebService: WhatsAppWebService,
    @Optional() private digitalSelfLearning?: DigitalSelfLearningTrigger,
  ) {}

  /**
   * Single indirection point for every outbound send that has a real
   * Messenger equivalent (text, media) -- branches once on the conversation's
   * channel instead of every call site hardcoding WhatsAppService. Defaults
   * to WhatsApp when no channel is tagged yet (every pre-existing
   * conversation), so this is a zero-behavior-change refactor for WhatsApp.
   * WhatsApp-only concepts with no Messenger equivalent (templates, location
   * messages, contact-card messages) are NOT routed through here -- their
   * call sites guard against being used on a Messenger conversation instead
   * (see sendMessage()).
   */
  private async dispatchOutbound(
    tenantId: string,
    conversation: { channel?: { id: string; type: string } | null; whatsappNumberId?: string | null },
    contact: { phone: string | null; externalId?: string | null; externalIdType?: string | null },
    payload:
      | { kind: 'TEXT'; text: string; replyToWaMessageId?: string; replyToProviderId?: string }
      | { kind: 'MEDIA'; mediaType: MessageType; mediaUrl: string; caption?: string; replyToWaMessageId?: string; replyToProviderId?: string },
  ): Promise<string | undefined> {
    // A simulated recipient is never handed to a channel, whoever asks (a bot flow, a human typing in the Inbox, a retry).
    if (isSimulatedPhone(contact.phone)) throw new SimulatedRecipientError();
    if (conversation.channel?.type === 'FACEBOOK_MESSENGER') {
      if (!contact.externalId) throw new BadRequestException('This Messenger contact has no PSID on file.');
      if (payload.kind === 'TEXT') {
        return this.facebookMessengerService.sendTextMessage(tenantId, conversation.channel.id, contact.externalId, payload.text, payload.replyToProviderId);
      }
      return this.facebookMessengerService.sendMediaMessage(
        tenantId, conversation.channel.id, contact.externalId, payload.mediaType.toLowerCase(), payload.mediaUrl, payload.caption,
        { file: await this.prepareMetaFile(payload.mediaType, payload.mediaUrl), replyToMid: payload.replyToProviderId },
      );
    }

    if (conversation.channel?.type === 'INSTAGRAM') {
      if (!contact.externalId) throw new BadRequestException('This Instagram contact has no Instagram ID on file.');
      if (payload.kind === 'TEXT') {
        return this.facebookMessengerService.sendInstagramTextMessage(tenantId, conversation.channel.id, contact.externalId, payload.text, payload.replyToProviderId);
      }
      return this.facebookMessengerService.sendInstagramMediaMessage(
        tenantId, conversation.channel.id, contact.externalId, payload.mediaType.toLowerCase(), payload.mediaUrl, payload.caption,
        { file: await this.prepareMetaFile(payload.mediaType, payload.mediaUrl), replyToMid: payload.replyToProviderId },
      );
    }

    // Unofficial WhatsApp Web (QR/linked-device) -- unlike Messenger, this
    // contact genuinely has a real phone number (contact.phone), since
    // Baileys addresses recipients by phone/JID rather than a page-scoped
    // id. Still needs its own branch: the send transport is a live Baileys
    // socket via apps/whatsapp-web, not the Cloud API Graph client below.
    if (conversation.channel?.type === 'WHATSAPP_WEB') {
      if (!conversation.channel.id) throw new BadRequestException('This conversation has no WhatsApp Web channel on file.');
      // Contacts WhatsApp only identifies by an anonymous address are replied to at that exact address.
      const target: string | { jid: string } | null = contact.phone
        ? contact.phone
        : (contact.externalIdType === 'WHATSAPP_JID' && contact.externalId ? { jid: contact.externalId } : null);
      if (!target) throw new BadRequestException('This contact has no phone number on file.');
      if (payload.kind === 'TEXT') {
        return this.whatsAppWebService.sendText(tenantId, conversation.channel.id, target, payload.text);
      }
      if (payload.mediaType === MessageType.AUDIO) {
        const audio = await this.prepareWhatsAppWebAudio(tenantId, payload.mediaUrl);
        // WhatsApp ignores captions on audio, and the composer's "Voice note" label is not one.
        return this.whatsAppWebService.sendMedia(tenantId, conversation.channel.id, target, audio.url, 'audio', undefined, { voiceNote: audio.voiceNote });
      }
      return this.whatsAppWebService.sendMedia(
        tenantId, conversation.channel.id, target, payload.mediaUrl, payload.mediaType.toLowerCase() as 'image' | 'video' | 'audio' | 'document', payload.caption,
      );
    }

    if (!contact.phone) throw new BadRequestException('This contact has no phone number on file.');
    if (payload.kind === 'TEXT') {
      return this.whatsappService.sendTextMessage(tenantId, contact.phone, payload.text, payload.replyToWaMessageId, conversation.whatsappNumberId);
    }
    return this.deliverMedia(tenantId, contact.phone, payload.mediaType, payload.mediaUrl, payload.caption, payload.replyToWaMessageId, conversation.whatsappNumberId);
  }

  // Idempotency for client retries (lost response, double click, offline-queue replay). In-process
  // only -- like runExclusiveForConversation it assumes a single backend replica.
  private readonly recentClientSends = new Map<string, { promise: Promise<unknown>; at: number }>();

  async sendMessage(tenantId: string, conversationId: string, senderId: string, dto: SendMessageDto, senderRole?: UserRole) {
    const clientId = dto.clientMessageId;
    if (!clientId) return this.sendMessageOnce(tenantId, conversationId, senderId, dto, senderRole);

    const now = Date.now();
    for (const [k, v] of this.recentClientSends) if (now - v.at > CLIENT_SEND_DEDUPE_TTL_MS) this.recentClientSends.delete(k);
    // Scoped to tenant + conversation + sender so one client's id can never replay another's message.
    const key = `${tenantId}:${conversationId}:${senderId}:${clientId}`;
    const existing = this.recentClientSends.get(key);
    if (existing) return existing.promise as ReturnType<MessagesService['sendMessageOnce']>;

    const promise = this.sendMessageOnce(tenantId, conversationId, senderId, dto, senderRole);
    this.recentClientSends.set(key, { promise, at: now });
    try {
      const result = await promise;
      // A FAILED outcome must stay retryable with the same id.
      if (result?.status === MessageStatus.FAILED) this.recentClientSends.delete(key);
      return result;
    } catch (error) {
      this.recentClientSends.delete(key);
      throw error;
    }
  }

  private async sendMessageOnce(tenantId: string, conversationId: string, senderId: string, dto: SendMessageDto, senderRole?: UserRole) {
    this.logger.debug(`sendMessage type=${dto.type} conversation=${conversationId}`);
    const conversation = await this.conversationsService.findOne(tenantId, conversationId);
    const contact = await this.contactsService.findOne(tenantId, conversation.contactId);

    if (contact.isBlocked || contact.optedOut) {
      throw new NotFoundException('Cannot send message to this contact');
    }

    // Server-side mirror of the inbox rule "a conversation owned by a human agent is locked to
    // them -- everyone else must take over first". Without it a stale UI (or a file dropped on
    // the chat pane) could send into, and auto-reopen, another agent's conversation.
    const owner = conversation.assignedTo;
    if (owner && !owner.isAiAgent && owner.id !== senderId) {
      throw new ForbiddenException('This conversation is being handled by another agent. Take it over before sending.');
    }

    const isMessenger = conversation.channel?.type === 'FACEBOOK_MESSENGER' || conversation.channel?.type === 'INSTAGRAM';
    const messengerLabel = conversation.channel?.type === 'INSTAGRAM' ? 'Instagram' : 'Facebook Messenger';
    // Unofficial WhatsApp Web (QR/linked-device): a real Baileys socket, not
    // the Cloud API Graph client -- Meta-specific concepts below (templates,
    // the 24h customer-service window) don't apply to it either.
    const isWhatsAppWeb = conversation.channel?.type === 'WHATSAPP_WEB';

    // A contact with neither identifier (e.g. a channel not yet supported at
    // all) has nothing this method can deliver to.
    if (!contact.phone && !contact.externalId) {
      throw new BadRequestException('This contact has no channel identity on file.');
    }

    // Template/location/contact-card messages are Cloud-API-specific concepts
    // with no Messenger or WhatsApp Web equivalent (not currently implemented
    // by the Baileys session-manager either) -- fail loudly rather than
    // attempt (and silently mis-send via) a Cloud-API-shaped call for a
    // Messenger or WhatsApp Web contact.
    if ((isMessenger || isWhatsAppWeb) && ([MessageType.TEMPLATE, MessageType.LOCATION, MessageType.CONTACTS] as MessageType[]).includes(dto.type as MessageType)) {
      throw new BadRequestException(`${dto.type} messages are not supported on ${isMessenger ? messengerLabel : 'WhatsApp Web'}.`);
    }

    // WhatsApp Cloud API only allows free-form (non-template) sends within 24h
    // of the customer's last inbound message; outside that window Meta accepts
    // a non-template send then asynchronously rejects it (error 131047,
    // "Re-engagement message"). Reject synchronously here instead of
    // creating a message that silently flips from sent to failed a moment
    // later -- the agent needs to know immediately, before they walk away
    // thinking it went through. Messenger has its own (different) messaging-
    // window rules, not enforced here yet -- out of scope for this pass.
    // WhatsApp Web has no such window at all (a real linked personal account
    // can message anyone anytime), so it's excluded the same way Messenger is.
    if (channelHasCustomerServiceWindow(conversation.channel?.type) && dto.type !== MessageType.TEMPLATE) {
      // Must be the last INBOUND message: lastMessageAt is bumped by our own outbound sends and
      // would let agent replies keep the window open past what Meta actually allows.
      const lastInbound = await this.prisma.message.findFirst({
        where: { tenantId, conversationId, direction: MessageDirection.INBOUND },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (!isCustomerServiceWindowOpen(lastInbound?.createdAt)) {
        throw new BadRequestException(
          "This contact hasn't messaged in over 24 hours. WhatsApp requires an approved template message to re-engage them, free-form messages will be rejected.",
        );
      }
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

    // Provenance of the text. The inbox says when a message is a saved reply or AI-written; each id is checked against THIS tenant's own
    // records before it is trusted, so a client cannot label arbitrary text, and an unknown id is simply ignored. Digital Self learning
    // skips both kinds because neither is the agent's own writing.
    if ((dto.type === MessageType.TEXT || !dto.type) && (dto.cannedResponseId || dto.aiSuggestionLogId)) {
      const [saved, suggestion] = await Promise.all([
        dto.cannedResponseId ? this.prisma.cannedResponse.findFirst({ where: { id: dto.cannedResponseId, tenantId }, select: { id: true } }) : null,
        dto.aiSuggestionLogId ? this.prisma.aiInteractionLog.findFirst({ where: { id: dto.aiSuggestionLogId, tenantId }, select: { id: true } }) : null,
      ]);
      if (suggestion) {
        messageMetadata['source'] = 'ai_suggestion';
        messageMetadata['aiSuggestionLogId'] = suggestion.id;
      } else if (saved) {
        messageMetadata['source'] = 'saved_reply';
        messageMetadata['cannedResponseId'] = saved.id;
      }
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

    // Resolve replyToId against a real, persisted message in this conversation before insert.
    // dto.replyToId can be stale (message since deleted) or a client-side optimistic/temp id
    // that never made it to the server — either would violate messages_reply_to_id_fkey.
    let validReplyToId: string | null = null;
    let replyToWaMessageId: string | undefined;
    // The provider's own id for the quoted message (a wamid for WhatsApp, a mid for Messenger/Instagram).
    let replyToProviderId: string | undefined;
    if (dto.replyToId) {
      const replyToMsg = await this.prisma.message.findFirst({
        where: { id: dto.replyToId, conversationId },
        select: { id: true, whatsappMessageId: true },
      });
      if (replyToMsg) {
        validReplyToId = replyToMsg.id;
        // Only use the wamid if it's a valid WhatsApp message ID (starts with "wamid.")
        replyToWaMessageId = replyToMsg.whatsappMessageId?.startsWith('wamid.') ? replyToMsg.whatsappMessageId : undefined;
        replyToProviderId = replyToMsg.whatsappMessageId ?? undefined;
      } else {
        this.logger.warn(`Dropping unresolvable replyToId=${dto.replyToId} for conversation=${conversationId}`);
      }
    }

    const message = await this.prisma.message.create({
      data: {
        tenantId,
        conversationId,
        contactId: contact.id,
        senderId,
        replyToId: validReplyToId,
        direction: MessageDirection.OUTBOUND,
        type: (dto.type as MessageType) ?? MessageType.TEXT,
        status: MessageStatus.QUEUED,
        content: resolvedContent,
        mediaUrl: dto.mediaUrl,
        mediaCaption: dto.mediaCaption,
        templateId: dto.templateId,
        templateVariables: dto.templateVariables ?? undefined,
        metadata: Object.keys(messageMetadata).length > 0 ? (messageMetadata as Prisma.InputJsonValue) : undefined,
        whatsappNumberId: conversation.whatsappNumberId,
      },
      include: {
        replyTo: { select: { id: true, content: true, type: true, direction: true, mediaCaption: true } },
      },
    });

    let whatsappMessageId: string | undefined;
    // Set only when a provider call actually ran: a send that reached no branch must FAIL, not be marked SENT.
    let dispatched = false;
    const sendStartedAt = Date.now();
    const sendLabel = `${conversation.channel?.type ?? 'WHATSAPP'} ${dto.type ?? 'TEXT'}`;

    try {
      if (dto.type === MessageType.TEXT || !dto.type) {
        whatsappMessageId = await this.dispatchOutbound(tenantId, conversation, contact, { kind: 'TEXT', text: dto.content!, replyToWaMessageId, replyToProviderId });
        dispatched = true;
      } else if (([MessageType.IMAGE, MessageType.VIDEO, MessageType.AUDIO, MessageType.DOCUMENT] as MessageType[]).includes(dto.type as MessageType)) {
        if (dto.mediaUrl) {
          whatsappMessageId = await this.dispatchOutbound(tenantId, conversation, contact, {
            kind: 'MEDIA', mediaType: dto.type as MessageType, mediaUrl: dto.mediaUrl, caption: dto.mediaCaption, replyToWaMessageId, replyToProviderId,
          });
          dispatched = true;
        }
      } else if (dto.type === MessageType.TEMPLATE && dto.templateId) {
        // Guarded above: TEMPLATE never reaches here for a Messenger conversation.
        if (!contact.phone) throw new BadRequestException('This contact has no phone number on file.');
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
            conversation.whatsappNumberId,
          );
          dispatched = true;
        }
      } else if (dto.type === MessageType.LOCATION && dto.locationLatitude != null && dto.locationLongitude != null) {
        // Guarded above: LOCATION never reaches here for a Messenger conversation.
        if (!contact.phone) throw new BadRequestException('This contact has no phone number on file.');
        whatsappMessageId = await this.whatsappService.sendLocationMessage(
          tenantId,
          contact.phone,
          dto.locationLatitude,
          dto.locationLongitude,
          dto.locationName,
          dto.locationAddress,
          conversation.whatsappNumberId,
        );
        dispatched = true;
      } else if (dto.type === MessageType.CONTACTS && dto.contactName && dto.contactPhone) {
        // Guarded above: CONTACTS never reaches here for a Messenger conversation.
        if (!contact.phone) throw new BadRequestException('This contact has no phone number on file.');
        whatsappMessageId = await this.whatsappService.sendContactMessage(
          tenantId,
          contact.phone,
          dto.contactName,
          dto.contactPhone,
          conversation.whatsappNumberId,
        );
        dispatched = true;
      }

      if (!dispatched) {
        throw new BadRequestException('Nothing was sent: the message has no deliverable content (missing media, template, or required fields).');
      }

      await this.prisma.message.update({
        where: { id: message.id },
        data: {
          whatsappMessageId,
          status: MessageStatus.SENT,
          sentAt: new Date(),
        },
      });
      // Lifecycle trace for "sent but still shows as sending" reports: status, timing and whether the provider
      // returned an id. Never the message text.
      this.logger.log(`Send ${sendLabel} ${message.id}: accepted by provider in ${Date.now() - sendStartedAt}ms (provider id ${whatsappMessageId ? 'present' : 'MISSING'}), status QUEUED -> SENT`);

      // Outbound: bump recency for list ordering only. incrementUnread() would count our own
      // agent reply as an unread customer message.
      await this.conversationsService.touchLastMessage(conversationId);

      // Trigger real-time AI learning from this agent reply (throttled to once per 30 min per tenant)
      if (dto.type === MessageType.TEXT || !dto.type) {
        void this.knowledgeBaseService.triggerLearningAsync(tenantId);
        // Digital Self: queue this human reply for background style learning (flag-gated, never blocks or fails the send).
        void this.digitalSelfLearning?.enqueue(tenantId, message.id).catch((err: unknown) => this.logger.warn(`Could not queue Digital Self learning: ${err instanceof Error ? err.name : 'unknown error'}`));
      }

      const updatedMessage = await this.prisma.message.findUnique({
        where: { id: message.id },
        include: {
          sender: { select: { id: true, name: true, avatarUrl: true, isAiAgent: true } },
          replyTo: { select: { id: true, content: true, type: true, direction: true, mediaCaption: true } },
        },
      });
      this.realtimeService.emitNewMessage(tenantId, conversationId, updatedMessage!);

      return updatedMessage;
    } catch (error) {
      this.logger.warn(`Send ${sendLabel} ${message.id}: FAILED after ${Date.now() - sendStartedAt}ms: ${error instanceof Error ? error.message : 'unknown error'}`);
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

  /**
   * Verz-AI unification, Phase G: extracted from sendMessage()'s inline media
   * branch (previously the only caller) so the AI auto-reply path can reuse the
   * exact same upload-to-Meta chain -- download-or-proxy -> uploadMediaToMeta ->
   * sendMediaMessageById, falling back to a link-based send on any failure.
   * Second caller: handleAiAutoReply, when a tool (e.g. send_product_image)
   * triggered a media side effect this turn.
   */
  /**
   * Fetches the bytes behind a stored media URL: straight from our own storage when it is one of our
   * /media/serve links, otherwise over HTTP. Shared by the WhatsApp Cloud and WhatsApp Web send paths.
   */
  private async loadMediaBuffer(mediaUrl: string, fallbackMime: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const proxyMatch = mediaUrl.match(/\/api\/v1\/media\/serve\/(.+)/);
    if (proxyMatch) {
      const fileKey = proxyMatch[1].replace(/~/g, '/');
      const downloaded = await this.storageService.downloadBuffer(fileKey);
      if (downloaded) return { buffer: downloaded.buffer, mimeType: downloaded.mimeType || fallbackMime };
    }
    const dlRes = await axios.get<ArrayBuffer>(mediaUrl, { responseType: 'arraybuffer', timeout: 120_000 });
    return { buffer: Buffer.from(dlRes.data), mimeType: (dlRes.headers['content-type'] as string | undefined) ?? fallbackMime };
  }

  /**
   * Messenger and Instagram: loads the stored file so it can be uploaded to Meta directly, and converts voice notes
   * (browsers record WebM, which they cannot play) to M4A. If the file cannot be loaded at all we fall back to
   * sending the link; a voice note that cannot be converted fails the send with a clear reason instead.
   */
  private async prepareMetaFile(mediaType: MessageType, mediaUrl: string): Promise<OutboundFile | undefined> {
    let loaded: { buffer: Buffer; mimeType: string };
    try {
      loaded = await this.loadMediaBuffer(mediaUrl, 'application/octet-stream');
    } catch (err) {
      this.logger.warn(`Could not load media for direct upload to Meta (${err instanceof Error ? err.message : String(err)}); sending the link instead`);
      return undefined;
    }
    if (mediaType === MessageType.AUDIO && !isMetaPlayableAudio(loaded.buffer)) {
      try {
        return { buffer: await transcodeToM4a(loaded.buffer), mimeType: 'audio/mp4', filename: 'voice-note.m4a' };
      } catch (err) {
        this.logger.warn(`Voice note could not be converted for Meta: ${err instanceof Error ? err.message : String(err)}`);
        throw new BadRequestException('The voice note could not be converted to a format Messenger or Instagram can play. Please record it again.');
      }
    }
    const ext = loaded.mimeType.split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9]/gi, '') || 'bin';
    return { buffer: loaded.buffer, mimeType: loaded.mimeType.split(';')[0]!, filename: `file.${ext}` };
  }

  /**
   * WhatsApp only plays voice notes as OGG/Opus, but browsers record WebM/Opus. For a WhatsApp Web send, remux
   * the recording to OGG here (this container has ffmpeg; the WhatsApp Web container does not) and report whether
   * the result should go out as a push-to-talk voice note. Anything that cannot be made playable fails the send
   * with a clear reason instead of delivering a message the customer cannot play.
   */
  private async prepareWhatsAppWebAudio(tenantId: string, mediaUrl: string): Promise<{ url: string; voiceNote: boolean }> {
    const { buffer, mimeType } = await this.loadMediaBuffer(mediaUrl, 'audio/ogg');
    if (isWebmBuffer(buffer)) {
      try {
        const ogg = await transcodeWebmToOgg(buffer);
        const stored = await this.storageService.uploadRaw(ogg, 'audio/ogg', tenantId, 'voice-note.ogg');
        return { url: stored.fileUrl, voiceNote: true };
      } catch (err) {
        this.logger.warn(`Voice note could not be converted for WhatsApp Web: ${err instanceof Error ? err.message : String(err)}`);
        throw new BadRequestException('The voice note could not be converted to a format WhatsApp can play. Please record it again.');
      }
    }
    if (isOggBuffer(buffer)) return { url: mediaUrl, voiceNote: true };
    // MP3, M4A/AAC and similar are sent as an ordinary audio file rather than a voice-note bubble.
    if (!mimeType.toLowerCase().startsWith('audio/')) {
      throw new BadRequestException('That file is not an audio recording WhatsApp can play.');
    }
    return { url: mediaUrl, voiceNote: false };
  }

  private async deliverMedia(
    tenantId: string, toPhone: string, type: MessageType, mediaUrl: string, caption?: string, replyToWaMessageId?: string,
    whatsappNumberId?: string | null,
  ): Promise<string | undefined> {
    const defaultMime: Record<string, string> = {
      [MessageType.AUDIO]: 'audio/ogg',
      [MessageType.VIDEO]: 'video/mp4',
      [MessageType.IMAGE]: 'image/jpeg',
      [MessageType.DOCUMENT]: 'application/pdf',
    };
    try {
      const { buffer: mediaBuffer, mimeType } = await this.loadMediaBuffer(mediaUrl, defaultMime[type as string] ?? 'application/octet-stream');

      const ext = mimeType.split('/')[1]?.split(';')[0] ?? 'bin';
      const metaMediaId = await this.whatsappService.uploadMediaToMeta(tenantId, mediaBuffer, mimeType, `media.${ext}`, whatsappNumberId);
      return await this.whatsappService.sendMediaMessageById(tenantId, toPhone, type.toLowerCase(), metaMediaId, caption, replyToWaMessageId, whatsappNumberId);
    } catch (err) {
      // Fall back to a link-based send, but say why: this used to hide every upload failure.
      this.logger.warn(`Media upload to Meta failed for ${type}; falling back to a link send: ${err instanceof Error ? err.message : String(err)}`);
      return this.whatsappService.sendMediaMessage(tenantId, toPhone, type.toLowerCase(), mediaUrl, caption, replyToWaMessageId, whatsappNumberId);
    }
  }

  async findByConversation(tenantId: string, conversationId: string, page = 1, limit = 50, search?: string, before?: string) {
    const conversation = await this.conversationsService.findOne(tenantId, conversationId);

    const msgInclude = {
      sender: { select: { id: true, name: true, avatarUrl: true, isAiAgent: true } },
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

  /**
   * Turns the first attachment of a Messenger or Instagram message into stored media (or, for Instagram shared
   * posts and stories, a labelled link). Shared by inbound messages and by echoes of replies sent outside VerzChat.
   * A failed download is reported and never fatal: the text of the message is still kept.
   */
  private async readMessengerAttachment(
    tenantId: string,
    platform: 'MESSENGER' | 'INSTAGRAM',
    message: { text?: string; attachments?: Array<{ type: string; payload: { url?: string } }> },
  ): Promise<{ content: string | undefined; mediaUrl: string | undefined; mediaType: string | undefined; msgType: MessageType }> {
    let content: string | undefined = message.text;
    let mediaUrl: string | undefined;
    let mediaType: string | undefined;
    let msgType: MessageType = MessageType.TEXT;

    const attachment = message.attachments?.[0];
    // Instagram also sends shared posts, reels and story mentions as "attachments" whose url is a web link, not a
    // file. Downloading that would store a web page as a document, so those are shown as a labelled link instead.
    const isFile = !!attachment && (platform !== 'INSTAGRAM' || attachment.type in MESSENGER_ATTACHMENT_TYPE_MAP);
    if (attachment?.payload?.url && !isFile) {
      const label = INSTAGRAM_LINK_LABELS[attachment.type] ?? 'Shared content';
      content = [message.text, `[${label}] ${attachment.payload.url}`].filter(Boolean).join('\n');
    }
    if (attachment?.payload?.url && isFile) {
      // Messenger's webhook payload already includes a fetchable CDN URL per
      // attachment -- unlike WhatsApp's Graph API, there's no separate
      // metadata-lookup-by-id step before the actual download.
      try {
        const mediaRes = await axios.get<ArrayBuffer>(attachment.payload.url, { responseType: 'arraybuffer', timeout: 30_000 });
        const contentType = (mediaRes.headers['content-type'] as string | undefined) ?? MESSENGER_ATTACHMENT_FALLBACK_MIME[attachment.type] ?? 'application/octet-stream';
        const ext = contentType.split('/')[1]?.split(';')[0] ?? 'bin';
        const uploadResult = await this.storageService.uploadRaw(Buffer.from(mediaRes.data), contentType, tenantId, `${attachment.type}.${ext}`);
        mediaUrl = uploadResult.fileUrl;
        mediaType = contentType;
        msgType = MESSENGER_ATTACHMENT_TYPE_MAP[attachment.type] ?? MessageType.DOCUMENT;
      } catch (err) {
        void notify({
          source: 'backend',
          tenantId,
          message: `Inbound Messenger media download failed for attachment type "${attachment.type}": ${err instanceof Error ? err.message : String(err)}, customer's file was not saved`,
        }).catch(() => {});
      }
    }

    return { content, mediaUrl, mediaType, msgType };
  }

  // Messenger's own inbound entry point -- deliberately separate from
  // handleInbound below rather than a shared method with branching:
  // handleInbound's ~450 lines are WhatsApp-payload-shaped throughout (CSAT/
  // call-permission interactive replies, ad-referral image mirroring,
  // WhatsApp's two-step media download), none of which apply to Messenger's
  // differently-shaped payload. What IS genuinely shared (channel-agnostic
  // media storage, realtime emit, the idempotency pattern) is reused as-is.
  //
  // AI auto-reply / welcome-message / bot-flow triggering intentionally NOT
  // wired up here yet -- those all currently call WhatsAppService directly;
  // hooking Messenger into them is the channel-aware outbound dispatcher's
  // job (a later phase), not this one. This phase only gets inbound
  // messages correctly persisted with real PSID-based Contact/Conversation
  // identity and visible in the inbox.
  async handleInboundMessenger(
    tenantId: string,
    channelId: string,
    senderPsid: string,
    message: { mid: string; text?: string; attachments?: Array<{ type: string; payload: { url?: string } }> },
    // Instagram messaging arrives through the same Meta Messaging webhook and shares this handler; only the
    // contact identity differs (an Instagram-scoped id instead of a Page-scoped one).
    platform: 'MESSENGER' | 'INSTAGRAM' = 'MESSENGER',
  ) {
    // Pre-check (mirrors handleInbound's) plus a P2002 catch around the
    // actual create below -- defense-in-depth against the race between two
    // concurrent webhook deliveries both passing this check before either
    // commits (Meta retries webhooks; this codebase doesn't otherwise use
    // find-then-skip alone as its only idempotency guard for new work).
    const alreadyProcessed = await this.prisma.message.findFirst({
      where: { whatsappMessageId: message.mid, tenantId },
      select: { id: true },
    });
    if (alreadyProcessed) return alreadyProcessed;

    const externalIdType = platform === 'INSTAGRAM' ? 'INSTAGRAM_IGSID' : 'MESSENGER_PSID';
    let contact = await this.contactsService.findOrCreateByExternalId(tenantId, externalIdType, senderPsid);
    // Meta only gives us an opaque id. Without a name the inbox shows "Unknown", so ask Meta for the display name
    // once, while the person is still writing to us. Never fatal, and the name itself is never logged.
    if (!contact.name) {
      try {
        const profile = await this.facebookMessengerService.fetchContactName(tenantId, channelId, platform, senderPsid);
        if (profile.name) {
          contact = await this.contactsService.findOrCreateByExternalId(tenantId, externalIdType, senderPsid, profile.name);
          this.logger.log(`${platform} contact profile lookup: name found`);
        } else {
          this.logger.warn(`${platform} contact profile lookup: no name (${profile.reason ?? 'unknown reason'})`);
        }
      } catch (err) {
        this.logger.warn(`${platform} contact profile lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const conversation = await this.conversationsService.findOrCreate(tenantId, contact.id, undefined, channelId);

    // Tag conversation with the receiving channel the first time only,
    // mirroring handleInbound's whatsappNumberId backfill below.
    if (!conversation.channelId) {
      await this.prisma.conversation.update({ where: { id: conversation.id }, data: { channelId } });
      (conversation as { channelId?: string | null }).channelId = channelId;
    }

    if (conversation.status === 'OPEN') {
      await this.conversationsService.request(tenantId, conversation.id);
    }

    const { content: ingestedContent, mediaUrl, mediaType, msgType } = await this.readMessengerAttachment(tenantId, platform, message);
    let content = ingestedContent;

    if (!content && !mediaUrl) {
      content = '[Sent a message type we can\'t display yet]';
    }

    let created: Message;
    let updatedConversation: { unreadCount?: number | null; status?: string } | undefined;
    try {
      const [msg, updatedConv] = await this.prisma.$transaction([
        this.prisma.message.create({
          data: {
            tenantId, conversationId: conversation.id, contactId: contact.id,
            whatsappMessageId: message.mid, channelId,
            direction: MessageDirection.INBOUND, type: msgType, status: MessageStatus.DELIVERED,
            content, mediaUrl, mediaType, deliveredAt: new Date(),
          },
        }),
        this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { unreadCount: { increment: 1 }, lastMessageAt: new Date() },
        }),
      ]);
      created = msg;
      updatedConversation = updatedConv;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.message.findFirst({ where: { whatsappMessageId: message.mid, tenantId } });
        if (raced) return raced;
      }
      throw err;
    }

    this.realtimeService.emitNewMessage(tenantId, conversation.id, created);
    this.realtimeService.emitConversationUpdated(tenantId, conversation.id, {
      id: conversation.id,
      // From the row the database just returned from the atomic increment. The in-memory copy was read before
      // it, so two quick customer messages both reported N+1 and the badge undercounted until a refresh.
      unreadCount: updatedConversation?.unreadCount ?? (conversation.unreadCount ?? 0) + 1,
      lastMessageAt: created.createdAt,
      lastInboundAt: created.createdAt,
      contact: (conversation as Record<string, unknown>)['contact'],
      status: updatedConversation?.status ?? conversation.status,
    });

    // Chatbot flows, automations and Verz AI work on these channels exactly as on WhatsApp. Only what the customer
    // actually typed is passed on: a media-only message, a shared post or the "can't display" placeholder is not a
    // question to answer. A failure here must never lose the message that is already stored.
    if (message.text) {
      await this.dispatchAiAndChatbot(tenantId, conversation, contact, message.text, created.id).catch((err) =>
        this.logger.warn(`AI/chatbot dispatch failed for inbound ${platform} message ${created.id}: ${err instanceof Error ? err.message : String(err)}`));
    }

    return created;
  }

  /**
   * A message the Page (or Instagram account) sent that did not come from VerzChat: a person replying from the
   * Facebook Page inbox, Meta Business Suite or the Messenger or Instagram app on another device. Meta reports it as an
   * "echo" (sender = the Page, recipient = the customer). Without this the reply never reaches VerzChat, so the
   * conversation looks unanswered and the customer's history is incomplete.
   *
   * Echoes of messages VerzChat itself sent (they carry our app id) are ignored here on purpose: the send path already
   * stored that message and attaches Meta's id to it a moment later, so storing it from the echo as well would create a
   * duplicate and make the send path's own update collide with the unique message id.
   *
   * It only records the message. It never reopens a resolved conversation, notifies the team, changes who owns the
   * conversation, or triggers the AI or chatbot, because a person is already handling it.
   */
  async handleMessengerEcho(
    tenantId: string,
    channelId: string,
    customerId: string,
    message: { mid: string; text?: string; app_id?: number | string | null; attachments?: Array<{ type: string; payload: { url?: string } }> },
    timestamp: number | undefined,
    platform: 'MESSENGER' | 'INSTAGRAM' = 'MESSENGER',
  ): Promise<{ status: 'stored'; message: Message } | { status: 'duplicate' | 'own-app' | 'ignored' }> {
    const sentByApp = message.app_id != null && String(message.app_id) !== '' ? String(message.app_id) : null;
    if (sentByApp) {
      // Our own sends carry our app id. If we do not know our app id we cannot tell ours from another app's, so skip
      // every echo that names an app rather than risk duplicating our own messages.
      const ownAppId = process.env['FACEBOOK_APP_ID'];
      if (!ownAppId || sentByApp === ownAppId) return { status: 'own-app' };
    }
    if (!customerId || !message.mid) return { status: 'ignored' };

    const existing = await this.prisma.message.findFirst({ where: { whatsappMessageId: message.mid, tenantId }, select: { id: true } });
    if (existing) return { status: 'duplicate' };

    const externalIdType = platform === 'INSTAGRAM' ? 'INSTAGRAM_IGSID' : 'MESSENGER_PSID';
    const contact = await this.contactsService.findOrCreateByExternalId(tenantId, externalIdType, customerId);
    // The latest thread with this customer, whatever its status. findOrCreate() would reopen a resolved one and alert
    // every agent, which is wrong for a reply a person already sent.
    let conversation = await this.prisma.conversation.findFirst({
      where: { tenantId, contactId: contact.id },
      orderBy: { updatedAt: 'desc' },
    });
    if (!conversation) {
      conversation = await this.prisma.conversation.create({ data: { tenantId, contactId: contact.id, channelId, status: 'OPEN' } });
    } else if (!conversation.channelId) {
      await this.prisma.conversation.update({ where: { id: conversation.id }, data: { channelId } });
    }

    const media = await this.readMessengerAttachment(tenantId, platform, message);
    const content = message.text ?? media.content ?? (media.mediaUrl ? undefined : '[Sent a message type we can\'t display yet]');
    const at = timestamp && Number.isFinite(timestamp) ? new Date(timestamp) : new Date();

    let created: Message;
    try {
      const [msg] = await this.prisma.$transaction([
        this.prisma.message.create({
          data: {
            tenantId, conversationId: conversation.id, contactId: contact.id, channelId,
            whatsappMessageId: message.mid, direction: MessageDirection.OUTBOUND, type: media.msgType,
            status: MessageStatus.SENT, content, mediaUrl: media.mediaUrl, mediaType: media.mediaType,
            sentAt: at, createdAt: at,
            metadata: { source: 'external', ...(sentByApp ? { appId: sentByApp } : {}) } as Prisma.InputJsonValue,
          },
        }),
        this.prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: at } }),
      ]);
      created = msg;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { status: 'duplicate' };
      throw err;
    }

    this.realtimeService.emitNewMessage(tenantId, conversation.id, created);
    this.realtimeService.emitConversationUpdated(tenantId, conversation.id, { id: conversation.id, lastMessageAt: at });
    return { status: 'stored', message: created };
  }

  // Unofficial WhatsApp Web (QR/linked-device) inbound entry point -- kept
  // separate from handleInbound() rather than force-unified with it, same
  // reasoning as handleInboundMessenger(): Baileys' payload shape and
  // identity model (real phone number, no per-number webhook routing) are
  // different enough from Meta's Cloud API webhook that sharing the parsing/
  // contact/conversation-creation code would be fragile. What genuinely is
  // shared (AI/chatbot dispatch) lives in dispatchAiAndChatbot() and is
  // called from both entry points.
  async handleInboundWhatsAppWeb(
    tenantId: string,
    channelId: string,
    // A phone number, or { jid } for a contact WhatsApp only exposes as an anonymous address
    // (@lid). Those are stored as their own provider identity, never as a fake phone number.
    sender: string | { jid: string },
    providerMessageId: string,
    payload: {
      content?: string;
      mediaType?: 'image' | 'video' | 'audio' | 'document';
      mediaBase64?: string;
      mimetype?: string;
      caption?: string;
      // The text is a label for something we cannot or must not ingest (view-once, sticker...), not
      // something the customer wrote, so the AI and chatbot must not reply to it.
      placeholder?: boolean;
    },
    pushName?: string,
  ) {
    const alreadyProcessed = await this.prisma.message.findFirst({
      where: { whatsappMessageId: providerMessageId, tenantId },
      select: { id: true },
    });
    if (alreadyProcessed) return alreadyProcessed;

    const contact = typeof sender === 'string'
      ? await this.contactsService.findOrCreate(tenantId, sender, pushName)
      : await this.contactsService.findOrCreateByExternalId(tenantId, 'WHATSAPP_JID', sender.jid, pushName);
    const conversation = await this.conversationsService.findOrCreate(tenantId, contact.id, undefined, undefined, channelId);

    // Tag conversation with the receiving channel the first time only,
    // mirroring handleInboundMessenger's own channelId backfill above --
    // findOrCreate() never writes channelId itself (used purely as a query
    // disambiguator), so every entry point that cares has to backfill it.
    if (!conversation.channelId) {
      await this.prisma.conversation.update({ where: { id: conversation.id }, data: { channelId } });
      (conversation as { channelId?: string | null }).channelId = channelId;
    }

    if (conversation.status === 'OPEN') {
      await this.conversationsService.request(tenantId, conversation.id);
    }

    let content = payload.content;
    let mediaUrl: string | undefined;
    const msgType: MessageType = payload.mediaType
      ? (WHATSAPP_WEB_MEDIA_TYPE_MAP[payload.mediaType] ?? MessageType.DOCUMENT)
      : MessageType.TEXT;

    if (payload.mediaType && payload.mediaBase64) {
      try {
        const buffer = Buffer.from(payload.mediaBase64, 'base64');
        const contentType = payload.mimetype ?? 'application/octet-stream';
        const ext = contentType.split('/')[1]?.split(';')[0] ?? 'bin';
        const uploadResult = await this.storageService.uploadRaw(buffer, contentType, tenantId, `${payload.mediaType}.${ext}`);
        mediaUrl = uploadResult.fileUrl;
      } catch (err) {
        void notify({
          source: 'backend',
          tenantId,
          message: `Inbound WhatsApp Web media download failed for type "${payload.mediaType}": ${err instanceof Error ? err.message : String(err)}, customer's file was not saved`,
        }).catch(() => {});
      }
    } else if (payload.mediaType && !payload.mediaBase64) {
      // The session-manager attempted the download and it failed (e.g. expired
      // media key) -- fall back to a visible placeholder rather than a silently
      // empty message, same as Messenger's own can't-display fallback.
      content = content ?? '[Sent a file we couldn\'t download]';
    }
    if (!content && !mediaUrl) {
      content = '[Sent a message type we can\'t display yet]';
    }

    let created: Message;
    let updatedConversation: { unreadCount?: number | null; status?: string } | undefined;
    try {
      const [msg, updatedConv] = await this.prisma.$transaction([
        this.prisma.message.create({
          data: {
            tenantId, conversationId: conversation.id, contactId: contact.id,
            whatsappMessageId: providerMessageId, channelId,
            direction: MessageDirection.INBOUND, type: msgType, status: MessageStatus.DELIVERED,
            content, mediaUrl, mediaCaption: payload.caption, mediaType: payload.mimetype, deliveredAt: new Date(),
          },
        }),
        this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { unreadCount: { increment: 1 }, lastMessageAt: new Date() },
        }),
      ]);
      created = msg;
      updatedConversation = updatedConv;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.message.findFirst({ where: { whatsappMessageId: providerMessageId, tenantId } });
        if (raced) return raced;
      }
      throw err;
    }

    this.realtimeService.emitNewMessage(tenantId, conversation.id, created);
    this.realtimeService.emitConversationUpdated(tenantId, conversation.id, {
      id: conversation.id,
      // From the row the database just returned from the atomic increment. The in-memory copy was read before
      // it, so two quick customer messages both reported N+1 and the badge undercounted until a refresh.
      unreadCount: updatedConversation?.unreadCount ?? (conversation.unreadCount ?? 0) + 1,
      lastMessageAt: created.createdAt,
      lastInboundAt: created.createdAt,
      contact: (conversation as Record<string, unknown>)['contact'],
      status: updatedConversation?.status ?? conversation.status,
    });

    const isPlaceholder = payload.placeholder === true || (!payload.content && !mediaUrl);
    if (!isPlaceholder) {
      await this.dispatchAiAndChatbot(tenantId, conversation, contact, content, created.id);
    }

    return created;
  }

  async handleInbound(tenantId: string, waMessage: {
    id: string;
    from: string;
    // Present instead of `from` once the sender has enabled a WhatsApp
    // username and hasn't messaged this business in 30+ days -- see
    // normalizePhone's BSUID handling in shared-utils.
    from_user_id?: string;
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
    button?: { payload: string; text: string };
  }, profileName?: string, incomingPhoneNumberId?: string, referral?: {
    source_url?: string; source_type?: string; source_id?: string; headline?: string; body?: string;
    image_url?: string; media_type?: string; ctwa_clid?: string;
  }) {
    // Meta omits `from` (and sends `from_user_id` instead -- a stable
    // "CC.digits" Business-Scoped User ID) once the sender has enabled a
    // WhatsApp username and hasn't messaged this business in 30+ days. This
    // is expected, documented Meta behavior, not a malformed payload --
    // every downstream path in this function uses `identity` instead of
    // `waMessage.from` directly, and normalizePhone() passes a BSUID
    // through unchanged so it round-trips correctly as this contact's
    // `phone` (Meta's Send API accepts a BSUID in the "to" field exactly
    // like a real phone number).
    const identity = waMessage.from || waMessage.from_user_id;
    if (!identity) {
      this.logger.warn(`[tenant:${tenantId}] Skipping inbound message with no "from" phone number or from_user_id: type="${waMessage.type}" id="${waMessage.id}"`);
      return null;
    }

    // Handle call permission reply — intercept before anything else so it never gets stored
    // as a regular inbound message or reopens a conversation.
    if (waMessage.type === 'interactive' && waMessage.interactive?.type === 'call_permission_reply') {
      const response = waMessage.interactive.call_permission_reply?.response ?? '';
      console.log(`[call_permission] ${response} from ${identity}`);
      this.realtimeService.emitCallEvent(tenantId, 'call_permission_updated', {
        phone: identity,
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
          const contact = await this.contactsService.findOrCreate(tenantId, identity, profileName);
          // Find the most-recently resolved conversation for this contact that hasn't been rated yet
          const resolvedConv = await this.prisma.conversation.findFirst({
            where: { tenantId, contactId: contact.id, csatScore: null, resolvedAt: { not: null } },
            orderBy: { resolvedAt: 'desc' },
            select: { id: true, whatsappNumberId: true },
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
                  whatsappNumberId: resolvedConv.whatsappNumberId,
                },
              });
              // A simulated recipient gets no provider call and is not reported as sent.
              const simulatedRecipient = isSimulatedPhone(contact.phone);
              const waId = simulatedRecipient ? null : await this.whatsappService.sendTextMessage(tenantId, contact.phone, thankYouText, undefined, resolvedConv.whatsappNumberId).catch(() => null);
              const sentMsg = await this.prisma.message.update({
                where: { id: msg.id },
                data: simulatedRecipient
                  ? { metadata: SIMULATED_MESSAGE_METADATA }
                  : {
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

    const contact = await this.contactsService.findOrCreate(tenantId, identity, profileName);

    // Mirror the Facebook CDN ad-preview image to our own storage so the URL never expires.
    let permanentAdImageUrl: string | undefined;
    if (referral?.image_url) {
      try {
        // Meta's ad-image CDN returns 403 to requests without a browser-like User-Agent
        // (axios's default `axios/x.y.z` UA is rejected). Present a real browser UA.
        const imgResp = await axios.get<Buffer>(referral.image_url, {
          responseType: 'arraybuffer',
          timeout: 10_000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
        });
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
        // Meta's ad-preview CDN URL is short-lived -- falling back to it just defers the
        // same failure to the browser a few minutes later, as a silently-broken <img>.
        // Leave it unset so the ad banner degrades to headline-only instead.
        const reason = (err as Error).message;
        this.logger.warn(`Failed to mirror ad preview image: ${reason}`);
        void notify({
          source: 'backend',
          tenantId,
          message: `Failed to mirror WhatsApp ad-preview image: ${reason}`,
        }).catch(() => {});
      }
    }

    // Resolved up front (rather than after findOrCreate, as before) so it can be
    // used to keep this contact's conversations on different numbers separate --
    // see the dedup comment on findOrCreate itself.
    const incomingWaNum = incomingPhoneNumberId
      ? await this.prisma.whatsAppNumber.findUnique({
          where: { tenantId_phoneNumberId: { tenantId, phoneNumberId: incomingPhoneNumberId } },
          select: { id: true },
        })
      : null;

    const conversation = await this.conversationsService.findOrCreate(tenantId, contact.id, referral
      ? {
          contactSource: referral.source_type ?? 'ad',
          adSourceId: referral.source_id,
          adHeadline: referral.headline,
          adImageUrl: permanentAdImageUrl,
        }
      : undefined,
      incomingWaNum?.id,
    );

    // Tag conversation with which WhatsApp number received this message (first time only)
    if (incomingWaNum && !conversation.whatsappNumberId) {
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { whatsappNumberId: incomingWaNum.id },
      });
      (conversation as { whatsappNumberId?: string }).whatsappNumberId = incomingWaNum.id;
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
        // MessageReaction.userId is a FK to the platform User table (agents/admins) —
        // a WhatsApp contact is never a User, so it can never satisfy that constraint.
        // Conversations have exactly one contact, so a null userId unambiguously means
        // "the contact reacted." WhatsApp only allows one active reaction per person per
        // message, so clear any prior contact reaction before recording the new one.
        await this.prisma.messageReaction.deleteMany({ where: { messageId: targetMsg.id, userId: null } });
        if (emoji) {
          await this.prisma.messageReaction.create({
            data: { messageId: targetMsg.id, tenantId, userId: null, emoji },
          });
        }
        const updatedReactions = await this.prisma.messageReaction.findMany({
          where: { messageId: targetMsg.id },
          select: { id: true, emoji: true, userId: true },
        });
        this.realtimeService.emitReactionUpdated(tenantId, conversation.id, targetMsg.id, updatedReactions);
      }
      return null;
    }

    // Production bug fix (contacts/messages don't load): the OPEN->REQUESTED
    // escalation below used to run unconditionally right after findOrCreate,
    // BEFORE the deleted/reaction checks above and the unsupported-type check
    // below -- all three of which can return null (or, for unsupported types,
    // previously returned null) without ever creating a Message row. That left
    // real, reproduced cases of a conversation created and escalated to
    // REQUESTED ("customer needs a human") with zero messages ever attached --
    // support staff would open it and see nothing, with no way to tell a real
    // failure apart from an empty shell. Moved here, after both no-message
    // early-returns, so escalation only ever fires once we know a message
    // (real or the unsupported-type placeholder just below) will actually be
    // persisted.
    let content: string | undefined;
    let mediaUrl: string | undefined;
    let mediaType: string | undefined;
    let mediaCaption: string | undefined;
    const messageMetadata: Record<string, unknown> = {};

    let msgType = waMessage.type.toUpperCase() as MessageType;

    // Quick Reply button tap on a business-sent template -- common in real traffic.
    // "button" has no corresponding MessageType enum value (that's a DB-level enum;
    // adding one is a migration, out of scope here), so without this it would fall
    // into the generic unsupported-type branch below -- same ultimate display as a
    // real text message makes sense, so store it as TEXT with the real tapped label
    // as content, same as the unsupported branch does for things with no content.
    if (waMessage.type === 'button' && waMessage.button) {
      content = waMessage.button.text;
      msgType = MessageType.TEXT;
    }

    // WhatsApp sends type="unsupported" for polls, ephemeral messages, and other
    // types not yet exposed via the Cloud API. Previously skipped silently (debug-
    // level log only, filtered out in production) -- the customer's message vanished
    // with zero trace for support staff, who'd just see an empty conversation. Now
    // persisted as a visible placeholder instead, same as any other inbound message,
    // so at least "the customer tried to send something we can't display yet" is
    // visible rather than nothing at all.
    const validMessageTypes = new Set<string>(Object.values(MessageType));
    if (waMessage.type !== 'button' && !validMessageTypes.has(msgType)) {
      this.logger.warn(`[tenant:${tenantId}] Unsupported WA message type "${waMessage.type}" -- persisting a placeholder instead of discarding it`);
      messageMetadata['originalWaType'] = waMessage.type;
      content = `[Sent a message type we can't display yet: ${waMessage.type}. Ask them to resend as text, an image, or a document.]`;
      msgType = MessageType.TEXT;
    }

    if (conversation.status === 'OPEN') {
      await this.conversationsService.request(tenantId, conversation.id);
    }

    if (waMessage.text) content = waMessage.text.body;

    // Non-CSAT interactive reply (list/button tap on an interactive message this
    // business sent). CSAT (`csat_*`) and call_permission_reply are intercepted
    // earlier and return before reaching here; this covers everything else, which
    // previously passed the MessageType validity check (INTERACTIVE is a real enum
    // value) but never had its content populated, so it displayed as empty/"Unsupported".
    if (waMessage.interactive?.list_reply) content = waMessage.interactive.list_reply.title;
    else if (waMessage.interactive?.button_reply) content = waMessage.interactive.button_reply.title;

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

      const downloaded = await this.whatsappService.downloadMetaMedia(tenantId, mediaId, conversation.whatsappNumberId);
      if (downloaded.ok) {
        const ext = downloaded.mimeType.split('/')[1]?.split(';')[0] ?? 'bin';
        const uploadResult = await this.storageService.uploadRaw(
          downloaded.buffer,
          downloaded.mimeType,
          tenantId,
          `${filename}.${ext}`,
        );
        mediaUrl = uploadResult.fileUrl;
      } else {
        // Without this, the message silently lands with no mediaUrl at all and nobody
        // is told the customer's file never made it into the inbox. Include the actual
        // reason (not just a generic "it failed") so the alert is self-diagnosing.
        void notify({
          source: 'backend',
          tenantId,
          message: `Inbound WhatsApp media download failed for message type "${waMessage.type}": ${downloaded.reason}, customer's file was not saved`,
        }).catch(() => {});
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

    // Atomic: create message and increment conversation unread count together.
    // The alreadyProcessed check above is a fast pre-check, not a lock -- two
    // concurrent deliveries of the same Meta webhook retry can both pass it and
    // race to create here. The whatsappMessageId+tenantId unique constraint is
    // the real guard; on P2002 the other delivery won the race, so fetch and
    // return what it created instead of erroring the whole webhook out.
    let updatedConversation: { unreadCount?: number | null; status?: string } | undefined;
    let message: Prisma.MessageGetPayload<{ include: { replyTo: { select: { id: true; content: true; type: true; direction: true; mediaCaption: true } } } }>;
    try {
      [message, updatedConversation] = await this.prisma.$transaction([
        this.prisma.message.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            contactId: contact.id,
            whatsappNumberId: conversation.whatsappNumberId,
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
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.message.findFirst({
          where: { whatsappMessageId: waMessage.id, tenantId },
          include: { replyTo: { select: { id: true, content: true, type: true, direction: true, mediaCaption: true } } },
        });
        if (raced) return raced;
      }
      throw err;
    }
    this.realtimeService.emitNewMessage(tenantId, conversation.id, message);
    this.realtimeService.emitConversationUpdated(tenantId, conversation.id, {
      id: conversation.id,
      // From the row the database just returned from the atomic increment. The in-memory copy was read before
      // it, so two quick customer messages both reported N+1 and the badge undercounted until a refresh.
      unreadCount: updatedConversation?.unreadCount ?? (conversation.unreadCount ?? 0) + 1,
      lastMessageAt: message.createdAt,
      lastInboundAt: message.createdAt,
      contact: (conversation as Record<string, unknown>)['contact'],
      status: updatedConversation?.status ?? conversation.status,
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
              data: { tenantId, conversationId: conversation.id, contactId: contact.id, direction: MessageDirection.OUTBOUND, type: MessageType.TEXT, status: MessageStatus.QUEUED, content: welcomeText, whatsappNumberId: conversation.whatsappNumberId, metadata: { isAutoReply: true } as never },
            });
            // A simulated recipient gets no provider call and is not reported as sent.
            const simulatedRecipient = isSimulatedPhone(contact.phone);
            const waId = simulatedRecipient ? null : await this.whatsappService.sendTextMessage(tenantId, contact.phone, welcomeText, undefined, conversation.whatsappNumberId).catch(() => null);
            const sent = await this.prisma.message.update({
              where: { id: draft.id },
              data: simulatedRecipient
                ? { metadata: SIMULATED_MESSAGE_METADATA }
                : { whatsappMessageId: waId ?? undefined, status: waId ? MessageStatus.SENT : MessageStatus.FAILED, sentAt: waId ? new Date() : undefined },
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

    await this.dispatchAiAndChatbot(tenantId, conversation, contact, content, message.id);

    return message;
  }

  /**
   * The genuinely transport-agnostic part of inbound processing: chatbot-flow
   * matching and AI suggestion/auto-reply dispatch. Operates purely on
   * already-created Message/Conversation/Contact rows and a plain content
   * string, so it's shared between handleInbound() (WhatsApp Cloud) and
   * handleInboundWhatsAppWeb() -- unlike payload parsing and contact/
   * conversation creation, which stay separate per transport (too entangled
   * with each provider's own payload shape to safely force-unify).
   */
  private async dispatchAiAndChatbot(
    tenantId: string,
    conversation: { id: string; whatsappNumberId?: string | null; channel?: { id: string; type: string } | null; assignedTo?: { id: string; isAiAgent?: boolean; lastSeenAt?: Date | string | null } | null },
    contact: { id: string; phone: string | null; externalId?: string | null; name: string | null },
    content: string | undefined,
    excludeMessageId: string,
  ): Promise<void> {
    // Verz-AI unification, Phase M: resolved before flow-matching now (used to be
    // resolved after) so findMatchingFlow can know whether AI is actually switched on
    // for this tenant -- see the comment on findMatchingFlow for why that matters.
    const [tenantSettings, aiMode] = await Promise.all([
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { commerceEnabled: true, aiTakeoverWhenAgentAway: true, aiRestrictedToPhone: true } }).catch(() => null),
      this.aiResponderService.getMode(tenantId).catch(() => null),
    ]);
    const commerceEnabled = !!tenantSettings?.commerceEnabled;
    const takeoverEnabled = !!tenantSettings?.aiTakeoverWhenAgentAway;
    // Pilot-testing restriction: when set, AI is available to this one contact
    // only -- every other contact on the tenant is treated as if AI were off
    // entirely (fed into aiActive too, so chatbot-flow-matching doesn't think
    // AI is live for a contact it will never actually respond to).
    const aiAllowedForThisContact = isAiAllowedForContact(tenantSettings?.aiRestrictedToPhone, contact.phone ?? '');
    const aiActive = (aiMode === 'SUGGESTION' || aiMode === 'AUTO_REPLY') && aiAllowedForThisContact;

    // Trigger chatbot flow if one matches this message
    let flowMatched = false;
    if (content) {
      const priorInboundInConversation = await this.prisma.message.count({
        where: { tenantId, conversationId: conversation.id, direction: MessageDirection.INBOUND, id: { not: excludeMessageId } },
      });
      const flow = await this.chatbotFlowsService.findMatchingFlow(tenantId, content, priorInboundInConversation === 0, aiActive);
      if (flow) {
        flowMatched = true;
        void this.runBotFlow(tenantId, conversation, contact, flow.nodes as unknown as FlowNode[]);
      }
    }

    // AI responder: suggestion mode or auto-reply (only if no chatbot flow matched)
    // Skip if a human agent has taken over (assignedTo exists and is not an AI agent) --
    // UNLESS that agent has gone quiet and this tenant has opted into takeover (below).
    const assignedTo = conversation.assignedTo;
    const humanOwned = assignedTo && !assignedTo.isAiAgent;
    const agentAway = isAgentAway(assignedTo, takeoverEnabled, !!aiMode);
    if (content && !flowMatched && aiAllowedForThisContact && (!humanOwned || agentAway)) {
      // Verz-AI unification, Phase C: commerceEnabled and aiMode are resolved once,
      // together, so every tenant -- commerce-enabled or not -- goes through the same
      // SUGGESTION/AUTO_REPLY dispatch below. Commerce used to be checked here and
      // return early with its own bespoke send/log/self-assign logic, bypassing
      // aiMode, credit metering, and aiLogsService entirely (see generateAiReply);
      // it's now just one more input into the generator choice, so a commerce-enabled
      // tenant gets the same SUGGESTION-mode human review, credit metering, and audit
      // trail every other tenant already has.

      if (agentAway) {
        // Takeover: the point is not leaving the customer's message unanswered while
        // their assigned agent isn't around -- so this sends directly, regardless of
        // the tenant's configured aiMode, rather than adding another SUGGESTION nobody
        // is currently there to review. Conversation stays assigned to the human
        // (handleAiAutoReply's self-assign branch only fires when assignedTo is null).
        const shouldAi = await this.aiResponderService.shouldRespond(tenantId).catch(() => false);
        if (shouldAi) {
          void this.runExclusiveForConversation(conversation.id, () =>
            this.handleAiAutoReply(tenantId, conversation, contact, content, commerceEnabled, assignedTo, takeoverEnabled, !!aiMode, excludeMessageId));
        }
      } else if (aiMode === 'SUGGESTION') {
        // Verz AI Credits: Suggestion-mode replies now consume credits too (a real
        // behavior change) -- they cost real provider spend whether or not a human
        // ends up sending them, so they're gated the same way AUTO_REPLY already was.
        const hasCredits = await this.aiCreditsService.hasSufficientBalance(tenantId).catch(() => false);
        if (hasCredits) {
          // SUGGESTION MODE: generate a response, store it, push to agents via socket — never auto-send.
          // Verz-AI unification, Phase M: chained through the per-conversation lock so
          // a second inbound message arriving before this one finishes doesn't launch
          // a second, racing AI generation for the same conversation.
          void this.runExclusiveForConversation(conversation.id, () =>
            this.handleAiSuggestion(tenantId, conversation, contact, content, commerceEnabled, takeoverEnabled, !!aiMode, excludeMessageId));
        }
      } else if (aiMode === 'AUTO_REPLY') {
        const shouldAi = await this.aiResponderService.shouldRespond(tenantId).catch(() => false);
        if (shouldAi) {
          void this.runExclusiveForConversation(conversation.id, () =>
            this.handleAiAutoReply(tenantId, conversation, contact, content, commerceEnabled, assignedTo, takeoverEnabled, !!aiMode, excludeMessageId));
        }
      }
    }
  }

  /**
   * A simulated conversation never creates a real handoff: no staff are notified and no assignment changes. The outcome is
   * reported as successful so the simulated reply reads as it would in production.
   */
  private requestHandoff(simulated: boolean, tenantId: string, conversationId: string, reason: string): Promise<boolean> {
    if (simulated) {
      this.logger.log(`Handoff not requested for simulated conversation ${conversationId}`);
      return Promise.resolve(true);
    }
    return this.conversationsService.requestWithRetry(tenantId, conversationId, reason);
  }

  /**
   * Re-reads conversation ownership directly from the DB and recomputes the
   * same humanOwned/agentAway decision dispatchAiAndChatbot made at dispatch
   * time. Called immediately before a paid provider call and again
   * immediately before delivering its result, to narrow the gap between that
   * initial dispatch-time check (fresh at the instant the inbound message
   * arrived) and the point -- possibly several seconds later, after sitting
   * behind runExclusiveForConversation's per-conversation lock and/or a real
   * provider round-trip -- where the AI is actually about to generate or
   * send. A human agent can take over a conversation, or newly register as
   * present, at any point in that gap. This narrows the race; it does not
   * eliminate it -- a takeover can still land between the final check and the
   * external provider send.
   *
   * Fails CLOSED: a lookup failure, or the conversation having vanished, is
   * treated as "human-handled" (returns true -- AI must stay back), never as
   * "safe to proceed." An ambiguous or failed ownership check must never be
   * read as "this conversation is unowned."
   */
  private async isConversationHumanHandled(
    tenantId: string,
    conversationId: string,
    takeoverEnabled: boolean,
    aiEnabledForTenant: boolean,
  ): Promise<boolean> {
    const fresh = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { assignedTo: { select: { id: true, isAiAgent: true, lastSeenAt: true } } },
    }).catch((err) => {
      this.logger.warn(`AI ownership recheck failed for conversation ${conversationId} -- failing closed (treating as human-handled, suppressing this AI turn): ${String(err)}`);
      return undefined;
    });
    if (fresh === undefined || fresh === null) return true; // lookup failed or conversation vanished -- fail closed

    const assignedTo = fresh.assignedTo;
    const humanOwned = !!assignedTo && !assignedTo.isAiAgent;
    if (!humanOwned) return false; // not human-owned -- AI may proceed
    const agentAway = isAgentAway(assignedTo, takeoverEnabled, aiEnabledForTenant);
    return !agentAway; // humanOwned && !agentAway => still human-handled, AI must stay back
  }

  /**
   * True if this conversation already received a provider-failure apology, with a successful handoff request, within the cooldown.
   * A failed lookup answers false: the worst case is the old behaviour (one more apology), never a silent customer on a DB hiccup.
   */
  private async recentProviderFailureFallbackSent(tenantId: string, conversationId: string): Promise<boolean> {
    const prior = await this.prisma.message.findFirst({
      where: {
        tenantId,
        conversationId,
        direction: 'OUTBOUND',
        createdAt: { gte: new Date(Date.now() - PROVIDER_FAILURE_FALLBACK_COOLDOWN_MS) },
        AND: [{ metadata: { path: ['fallback'], equals: true } }, { metadata: { path: ['handoffRequested'], equals: true } }],
      },
      select: { id: true },
    }).catch((err) => {
      this.logger.warn(`Could not check for a recent AI fallback in conversation ${conversationId}: ${String(err)}`);
      return null;
    });
    return !!prior;
  }

  /**
   * Resolves the tenant's default AiAgent (lazily backfilled, shares the same
   * synthetic isAiAgent user the legacy responder uses) and runs the Verz-AI
   * v2 pipeline. Only called when the verz_ai_v2 feature flag is on.
   */
  private runVerzAiV2(
    tenantId: string, conversationId: string, contactId: string, customerPhone: string,
    customerMessage: string, contactName: string | undefined, readOnlyTools: boolean,
    channelType?: 'WHATSAPP' | 'FACEBOOK_MESSENGER',
    currentMessageId?: string,
    simulated?: boolean,
  ) {
    return this.aiAgentsService.findOrCreateDefaultAgent(tenantId).then((agent) =>
      this.verzAiPipeline.run({
        tenantId,
        agentId: agent.id,
        conversationId,
        customerMessage,
        currentMessageId,
        contactName,
        // A simulated (Test Chat) run is TEST: the existing metering rule leaves it unmetered, so no customer credits are settled.
        taskType: simulated ? 'TEST' : 'RESPONDER',
        ...(simulated && { simulated: true }),
        // Verz-AI unification, Phase E: turns GenerationStage's tool-calling
        // branch live for this tenant -- both were already in scope at this
        // call's one caller (generateAiReply), just never threaded through.
        contactId,
        customerPhone,
        readOnlyTools,
        channelType,
      }),
    );
  }

  /**
   * Verz-AI unification, Phase C: the single generator dispatch every aiMode branch
   * calls through. Commerce's own generator (CommerceAiService, already on shared
   * ai-core provider/tracing/tool-calling infrastructure since Phase A) is offered
   * whenever the tenant is commerce-enabled, regardless of the verz_ai_v2 flag --
   * that flag only ever chose between the v2 pipeline and the legacy responder for
   * NON-commerce tenants, so it's resolved lazily here rather than upfront. Every
   * branch is normalized into the same UnifiedAiResult shape before returning.
   */
  private async generateAiReply(
    tenantId: string,
    conversationId: string,
    contactId: string,
    customerPhone: string,
    content: string,
    contactName: string | undefined,
    opts: { commerceEnabled: boolean; readOnlyTools: boolean; channelType?: 'WHATSAPP' | 'FACEBOOK_MESSENGER'; currentMessageId?: string; simulated?: boolean },
  ): Promise<UnifiedAiResult> {
    if (opts.commerceEnabled) {
      const r = await this.commerceAiService.handleMessage(
        tenantId, conversationId, contactId, customerPhone, content, contactName, undefined,
        { readOnlyTools: opts.readOnlyTools, channelType: opts.channelType, currentMessageId: opts.currentMessageId, ...(opts.simulated && { simulated: true }) },
      );
      // Second hardening pass, Section 4: r.shouldEscalate was never mapped through
      // here before -- Commerce's own escalation branches called
      // conversations.request() directly instead, so this field was always dropped.
      // Now Commerce only signals the intent; this is the one place both orchestrators'
      // results converge, so it's also the one place the real handoff (with a real
      // retry, and an honest customer-facing text if it fails) happens -- see
      // handleAiAutoReply/handleAiSuggestion below.
      return this.withoutUnsupportedFollowUp({ response: r.response, confidence: null, blocked: r.blocked, executionId: r.executionId ?? null, shouldEscalate: r.shouldEscalate, toolTrace: r.toolTrace, mediaToSend: r.mediaToSend });
    }

    const useV2 = await this.featureFlagsService.isEnabledCached('verz_ai_v2', tenantId).catch(() => false);
    if (useV2) return this.runVerzAiV2(tenantId, conversationId, contactId, customerPhone, content, contactName, opts.readOnlyTools, opts.channelType, opts.currentMessageId, opts.simulated);

    // An explicit request for a person never needs the model: hand off for real (messages.service acts on
    // shouldEscalate in both AUTO_REPLY and SUGGESTION mode) and skip a paid call whose reply would be replaced anyway.
    // v2 and Commerce make the same detection in their own paths. The legacy responder had none, so a customer who
    // asked for a human got a knowledge-base answer instead.
    if (detectHumanRequest(content)) {
      return { response: HUMAN_HANDOFF_REPLY, confidence: null, blocked: false, executionId: null, shouldEscalate: true };
    }

    // What the provider actually did, observed from outside so the responder stays untouched.
    const startedAt = Date.now();
    const call: LegacyCallObservation = { invoked: false };
    const legacy = await this.aiResponderService.generateSuggestion(
      tenantId,
      conversationId,
      content,
      contactName,
      <T>(providerCall: () => Promise<T>) => {
        const observed = async (): Promise<T> => {
          call.invoked = true;
          try {
            const response = await providerCall();
            call.usage = readProviderUsage(response);
            return response;
          } catch (err) {
            call.error = describeProviderError(err);
            throw err;
          }
        };
        // A simulated run takes no credit hold: it is unmetered test usage, like every TEST task.
        return opts.simulated ? observed() : this.runLegacyAiProviderCall(tenantId, observed);
      },
      opts.currentMessageId,
    );
    // The legacy responder still uses a fixed estimate, but its provider request is
    // wrapped in the same durable hold so concurrent calls cannot spend held credits.
    // It is recorded WITHOUT credit metering for exactly that reason: the hold above already charges it, and recording it
    // as a normal RESPONDER execution would charge it a second time. The record makes the reply traceable and evaluable.
    const executionId = await this.recordLegacyExecution(tenantId, conversationId, buildLegacyTrace({ legacy, call, latencyMs: Date.now() - startedAt, simulated: opts.simulated }), opts.simulated);
    return this.withoutUnsupportedFollowUp({ ...legacy, executionId });
  }

  /**
   * A reply that promises the team will follow up, when no tool this turn arranged one, is replaced by a real handoff (the same
   * shouldEscalate path an explicit request for a person takes), so the customer is never told something that is not happening.
   * The v2 pipeline applies the same rule in its own policy stage.
   */
  private withoutUnsupportedFollowUp(result: UnifiedAiResult): UnifiedAiResult {
    if (result.shouldEscalate || !result.response || !isUnsupportedFollowUpPromise(result.response, result.toolTrace)) return result;
    return { ...result, response: HUMAN_HANDOFF_REPLY, shouldEscalate: true };
  }

  /** Recording is traceability, never a reason for the customer not to get a reply: a failure is logged and the turn goes on. */
  private async recordLegacyExecution(tenantId: string, conversationId: string, trace: Parameters<AiExecutionsService['record']>[1], simulated?: boolean): Promise<string | null> {
    try {
      const execution = await this.aiExecutionsService.record({ tenantId, conversationId, taskType: simulated ? 'TEST' : 'RESPONDER' }, trace, { meterCredits: false });
      return execution?.id ?? null;
    } catch (err) {
      this.logger.warn(`Failed to record the legacy AI execution for conversation ${conversationId}: ${String(err)}`);
      return null;
    }
  }

  private async runLegacyAiProviderCall<T>(tenantId: string, providerCall: () => Promise<T>): Promise<T> {
    const reservation = await this.aiCreditsService.reserveFixedCredits(tenantId, LEGACY_RESPONDER_FLAT_CREDIT_COST);
    try {
      const result = await providerCall();
      try {
        const settlement = await this.aiCreditsService.settleReservation(
          reservation.id,
          LEGACY_RESPONDER_FLAT_CREDIT_COST,
          'Legacy AI responder usage',
          { estimated: true, reason: 'legacy path, no token tracking' },
        );
        if (!settlement.settled) throw new Error(`Legacy AI reservation ${reservation.id} was not settled`);
      } catch (error) {
        this.logger.error(
          `Failed to settle legacy AI reservation ${reservation.id}; it remains held for conservative expiry`,
          error instanceof Error ? error.stack : String(error),
        );
      }
      return result;
    } catch (error) {
      if (this.isDefinitiveProviderRejection(error)) {
        await this.aiCreditsService.releaseReservation(reservation.id);
      } else {
        this.logger.warn(`Keeping legacy AI reservation ${reservation.id} for an uncertain provider outcome`);
      }
      throw error;
    }
  }

  private isDefinitiveProviderRejection(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('response' in error)) return false;
    const response = error.response;
    if (typeof response !== 'object' || response === null || !('status' in response) || typeof response.status !== 'number') return false;
    return response.status >= 400 && response.status < 500;
  }

  /** Fire-and-forget background lead scoring, throttled inside LeadsService (see
   * THROTTLE_MS) -- runs independently of the reply generated below it; a scoring
   * failure or delay must never affect reply latency or delivery. Only meaningful
   * for commerce-enabled tenants (Lead Intelligence is a sales/commerce concept). */
  private maybeScoreLead(tenantId: string, conversationId: string, contactId: string, commerceEnabled: boolean) {
    if (!commerceEnabled) return;
    void this.leadsService
      .scoreConversation(tenantId, conversationId, contactId)
      .catch((err) => this.logger.warn(`Background lead scoring failed for conversation ${conversationId}: ${String(err)}`));
  }

  private async handleAiSuggestion(
    tenantId: string,
    conversation: { id: string; channel?: { id: string; type: string } | null },
    contact: { id: string; phone: string | null; externalId?: string | null; name: string | null },
    content: string,
    commerceEnabled: boolean,
    takeoverEnabled: boolean,
    aiEnabledForTenant: boolean,
    currentMessageId?: string,
  ) {
    // Re-check ownership right before the paid provider call below -- this
    // closure may have sat behind runExclusiveForConversation's per-conversation
    // lock since dispatchAiAndChatbot's own (now possibly stale) check. See
    // isConversationHumanHandled's doc comment.
    if (await this.isConversationHumanHandled(tenantId, conversation.id, takeoverEnabled, aiEnabledForTenant)) {
      this.logger.log(`AI suggestion suppressed for conversation ${conversation.id}: a human agent is now handling this conversation (ownership recheck) -- no provider call made.`);
      return;
    }

    // Lead scoring is itself a paid (throttled) LLM call, so it runs only after the
    // ownership check above -- never for a human-handled conversation or on a failed lookup.
    const simulated = isSimulatedPhone(contact.phone);
    if (!simulated) this.maybeScoreLead(tenantId, conversation.id, contact.id, commerceEnabled); // a paid, metered call: not for a test conversation

    const startMs = Date.now();
    // SUGGESTION mode restricts Commerce to read-only tools: it has never run in
    // SUGGESTION mode before, so a human hasn't yet approved anything the AI wants to
    // do -- add_item_to_order/submit_order_for_payment/create_internal_task stay
    // withheld until AUTO_REPLY or a human sends the reply themselves. New safeguard
    // for a new capability, not a weakening of anything that exists today.
    const result = await this.generateAiReply(
      tenantId, conversation.id, contact.id, contact.phone ?? '', content, contact.name ?? undefined,
      { commerceEnabled, readOnlyTools: true, channelType: aiChannelType(conversation.channel?.type), currentMessageId, ...(simulated && { simulated: true }) },
    ).catch((err) => {
      this.logger.warn(`AI suggestion generation failed for conversation ${conversation.id}: ${String(err)}`);
      return null;
    });
    if (!result?.response) {
      // Verz-AI unification, Phase L: SUGGESTION mode never auto-sends to the
      // customer (a human reviews first), so there's no message to send here --
      // but silently doing nothing left the conversation stuck with no signal that
      // the AI couldn't produce a suggestion at all. Escalate for real instead.
      this.logger.warn(`AI suggestion generation produced no response at all for conversation ${conversation.id} -- escalating`);
      await this.requestHandoff(simulated, tenantId, conversation.id, 'AI escalation: suggestion generation threw before returning a response');
      return;
    }

    if (result.shouldEscalate) {
      // Second hardening pass, Section 4: SUGGESTION mode never auto-sends to the
      // customer (a human reviews first), so there's no customer-facing text to keep
      // honest here -- but the handoff itself should still be real and retried, not a
      // swallowed .catch(() => null).
      await this.requestHandoff(simulated, tenantId, conversation.id, 'AI escalation: customer requested a human, or the AI had very low confidence');
    }

    // Re-check again right before storing/surfacing the suggestion. Generation
    // (a real provider round-trip) can take several seconds -- long enough for
    // a human agent to take over mid-flight. SUGGESTION mode never reaches the
    // customer either way, but there is no reason to log an AI suggestion or
    // notify agents about one for a conversation a human has since taken over.
    if (await this.isConversationHumanHandled(tenantId, conversation.id, takeoverEnabled, aiEnabledForTenant)) {
      this.logger.log(`AI suggestion generated but NOT surfaced for conversation ${conversation.id}: a human agent took over during generation (ownership recheck) -- the generated suggestion was discarded.`);
      return;
    }

    const log = await this.aiLogsService.create({
      tenantId,
      conversationId: conversation.id,
      contactId: contact.id,
      customerMessage: content,
      aiResponse: result.response,
      status: 'SUGGESTED',
      confidenceScore: result.confidence,
      responseTimeMs: Date.now() - startMs,
    }).catch((err) => {
      this.logger.warn(`Failed to persist AI suggestion log for conversation ${conversation.id}: ${String(err)}`);
      return null;
    }) as { id: string } | null;
    if (!log) return;

    if (result.executionId) {
      await this.aiExecutionsService.linkInteractionLog(result.executionId, log.id).catch(() => null);
    }

    this.realtimeService.emitAiSuggestion(tenantId, conversation.id, {
      logId: log.id,
      response: result.response,
      confidence: result.confidence,
    });
  }

  private async handleAiAutoReply(
    tenantId: string,
    conversation: { id: string; whatsappNumberId?: string | null; channel?: { id: string; type: string } | null },
    contact: { id: string; phone: string | null; externalId?: string | null; name: string | null },
    content: string,
    commerceEnabled: boolean,
    assignedTo: { id: string; isAiAgent?: boolean } | null | undefined,
    takeoverEnabled: boolean,
    aiEnabledForTenant: boolean,
    currentMessageId?: string,
  ) {
    // Re-check ownership right before the paid provider call below -- this
    // closure may have sat behind runExclusiveForConversation's per-conversation
    // lock since dispatchAiAndChatbot's own (now possibly stale) check. See
    // isConversationHumanHandled's doc comment.
    if (await this.isConversationHumanHandled(tenantId, conversation.id, takeoverEnabled, aiEnabledForTenant)) {
      this.logger.log(`AI auto-reply suppressed for conversation ${conversation.id}: a human agent is now handling this conversation (ownership recheck) -- no provider call made.`);
      return;
    }

    // Lead scoring is itself a paid (throttled) LLM call, so it runs only after the
    // ownership check above -- never for a human-handled conversation or on a failed lookup.
    const simulated = isSimulatedPhone(contact.phone);
    if (!simulated) this.maybeScoreLead(tenantId, conversation.id, contact.id, commerceEnabled); // a paid, metered call: not for a test conversation

    const startMs = Date.now();
    const [result, verzAgent] = await Promise.all([
      this.generateAiReply(
        tenantId, conversation.id, contact.id, contact.phone ?? '', content, contact.name ?? undefined,
        { commerceEnabled, readOnlyTools: false, channelType: aiChannelType(conversation.channel?.type), currentMessageId, ...(simulated && { simulated: true }) },
      ).catch((err) => {
        this.logger.warn(`AI auto-reply generation failed for conversation ${conversation.id}: ${String(err)}`);
        return null;
      }),
      this.aiResponderService.findOrCreateVerzAgent(tenantId).catch(() => null),
    ]);

    // Re-check again right before delivering anything to the customer.
    // generateAiReply() above is a real provider round-trip that can take
    // several seconds -- long enough for a human agent to take over
    // mid-flight. That call has already happened and, in the ordinary success
    // case, already cost real money; this check cannot refund it. It only
    // stops delivery when a takeover is already visible in the database.
    // Limitation: the database read and the external provider send are not
    // atomic, so ownership can still change between this check and the send.
    if (await this.isConversationHumanHandled(tenantId, conversation.id, takeoverEnabled, aiEnabledForTenant)) {
      this.logger.log(`AI auto-reply generated but NOT delivered for conversation ${conversation.id}: a human agent took over during generation (ownership recheck before send) -- the generated reply was discarded, not sent.`);
      return;
    }

    // A provider outage must not turn into the same apology on every customer message. If this conversation was already told, with a
    // successful handoff request, a moment ago, stay quiet: the request is open and the customer's messages still reach the team.
    // A normal reply, or a provider that has recovered, is not affected: only a repeat of the failure is suppressed.
    if ((!result?.response || result.response === PROVIDER_FAILURE_FALLBACK_TEXT) && await this.recentProviderFailureFallbackSent(tenantId, conversation.id)) {
      this.logger.warn(`AI provider-failure fallback suppressed for conversation ${conversation.id}: the customer was already told and a handoff is already requested`);
      return;
    }

    if (!result?.response) {
      // Verz-AI unification, Phase L: this used to be a silent early return -- if
      // generateAiReply() threw outright (rather than returning a handled failure
      // result), the customer got nothing at all and nothing was logged as having
      // gone wrong. generateAiReply()'s own failure branches now always return
      // real text, so reaching here means the call threw before returning anything;
      // still give the customer something and get a human involved for real.
      this.logger.warn(`AI auto-reply produced no response at all for conversation ${conversation.id} -- sending fallback and escalating`);
      // Second hardening pass, Section 4: attempt the real handoff first (with a real
      // retry) so the text actually sent matches what really happened, instead of
      // sending an optimistic line and separately hoping the handoff also worked.
      const escalated = await this.requestHandoff(
        simulated, tenantId, conversation.id, 'AI escalation: AI reply generation threw before returning a response',
      );
      const fallbackText = escalated
        ? PROVIDER_FAILURE_FALLBACK_TEXT
        : HANDOFF_FAILED_TEXT;
      // requestWithRetry above is an awaited DB round-trip after the post-generation
      // check -- re-verify before the fallback text reaches the customer. The handoff
      // request itself is kept (it is the legitimate escalation, not a customer reply).
      if (await this.isConversationHumanHandled(tenantId, conversation.id, takeoverEnabled, aiEnabledForTenant)) {
        this.logger.log(`AI fallback reply NOT delivered for conversation ${conversation.id}: a human agent took over while the handoff request was pending (ownership recheck before send).`);
        return;
      }
      const fallbackDelivery = await this.sendAiText(tenantId, conversation, contact, fallbackText);
      const fallbackMessage = await this.prisma.message.create({
        data: {
          tenantId, conversationId: conversation.id, contactId: contact.id, direction: 'OUTBOUND' as const, type: 'TEXT' as const,
          ...fallbackDelivery.fields, content: fallbackText, whatsappNumberId: conversation.whatsappNumberId,
          metadata: { aiGenerated: true, fallback: true, handoffRequested: escalated, ...(simulated ? SIMULATED_MESSAGE_METADATA : {}) },
        },
      }).catch((err) => {
        this.logger.warn(`Failed to persist the AI fallback message for conversation ${conversation.id}: ${String(err)}`);
        return null;
      });
      if (fallbackMessage) this.realtimeService.emitNewMessage(tenantId, conversation.id, fallbackMessage);
      return;
    }

    let handoffRequested = false;
    if (result.shouldEscalate) {
      // Second hardening pass, Section 4: backend-enforced handoff truth. The
      // generator's own text for this turn may already say something like "I'll get
      // someone to help" -- it was written without knowing whether the handoff would
      // actually succeed. This performs the real handoff (with a real retry, not a
      // swallowed .catch(() => null)) and only keeps that optimistic text if it's
      // actually true; if the handoff genuinely fails, the text sent to the customer
      // is rewritten to something honest instead of a claim that didn't happen.
      const escalated = await this.requestHandoff(
        simulated, tenantId, conversation.id, 'AI escalation: customer requested a human, or the AI had very low confidence',
      );
      handoffRequested = escalated;
      if (!escalated) {
        this.logger.warn(`Handoff failed (after retry) for conversation ${conversation.id} -- rewriting response to avoid a false claim`);
        result.response = HANDOFF_FAILED_TEXT;
      }
      // Same reasoning as the no-response branch: requestWithRetry was awaited after
      // the post-generation check, so re-verify before the send below.
      if (await this.isConversationHumanHandled(tenantId, conversation.id, takeoverEnabled, aiEnabledForTenant)) {
        this.logger.log(`AI escalation reply NOT delivered for conversation ${conversation.id}: a human agent took over while the handoff request was pending (ownership recheck before send).`);
        return;
      }
    }

    // Verz AI Credits: the flat -1-per-send decrement that used to live here is gone --
    // charging happens as part of generateAiReply() above (token-based for ai-core,
    // estimated and reservation-backed for the legacy path). By the
    // time we're here the AI call already happened and already cost real money --
    // the ownership recheck just above this is what decides whether the ALREADY-PAID-FOR
    // reply is still worth delivering; reaching this line means it passed that check.
    // Keep what the channel answered. The id lets delivered and read ticks find this message, and a refused send
    // is recorded as failed instead of being shown to the team as delivered.
    const delivery = await this.sendAiText(tenantId, conversation, contact, result.response);

    const log = await this.aiLogsService.create({
      tenantId,
      conversationId: conversation.id,
      contactId: contact.id,
      customerMessage: content,
      aiResponse: result.response,
      // A simulated reply is never AUTO_SENT: nothing was sent.
      status: simulated ? 'SIMULATED' : 'AUTO_SENT',
      confidenceScore: result.confidence,
      responseTimeMs: Date.now() - startMs,
    }).catch((err) => {
      this.logger.warn(`Failed to persist AI auto-reply log for conversation ${conversation.id}: ${String(err)}`);
      return null;
    }) as { id: string } | null;

    if (log && result.executionId) {
      await this.aiExecutionsService.linkInteractionLog(result.executionId, log.id).catch(() => null);
    }

    const aiMessage = await this.prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        contactId: contact.id,
        senderId: verzAgent?.id ?? null,
        direction: 'OUTBOUND' as const,
        type: 'TEXT' as const,
        ...delivery.fields,
        content: result.response,
        whatsappNumberId: conversation.whatsappNumberId,
        // commerce:true is preserved from the pre-unification Commerce branch's own
        // message metadata, so anything already keying off it keeps working.
        metadata: {
          ...(commerceEnabled ? { aiGenerated: true, commerce: true } : { aiGenerated: true }),
          // Marks a provider-failure apology so that a repeat within the cooldown can be recognised.
          ...(result.response === PROVIDER_FAILURE_FALLBACK_TEXT ? { fallback: true, handoffRequested } : {}),
          ...(simulated ? SIMULATED_MESSAGE_METADATA : {}),
        },
      },
      include: { sender: { select: { id: true, name: true, avatarUrl: true, isAiAgent: true } } },
    }).catch((err) => {
      this.logger.warn(`Failed to persist AI auto-reply message for conversation ${conversation.id}: ${String(err)}`);
      return null;
    });
    if (!aiMessage) return;

    // Verz-AI unification, Phase G: deliver any media a tool triggered this turn
    // (e.g. send_product_image) via the same upload-to-Meta chain sendMessage()
    // uses for a human agent's manual media send. Text reply already sent above,
    // so images follow it -- matches natural WhatsApp UX. Persisted as its own
    // Message row so it's visible in the inbox like any other outbound message.
    for (const effect of result.mediaToSend ?? []) {
      // The text reply above and the awaits since (log, link, persist) leave a gap in
      // which a human can take over -- re-verify before EACH media send.
      if (await this.isConversationHumanHandled(tenantId, conversation.id, takeoverEnabled, aiEnabledForTenant)) {
        this.logger.log(`AI-triggered media NOT delivered for conversation ${conversation.id}: a human agent took over after the text reply (ownership recheck before media send).`);
        break;
      }
      const whatsappMessageId = simulated ? undefined : await this.dispatchOutbound(tenantId, conversation, contact, { kind: 'MEDIA', mediaType: 'IMAGE' as MessageType, mediaUrl: effect.mediaUrl, caption: effect.caption }).catch((err) => {
        this.logger.warn(`Failed to deliver AI-triggered media for conversation ${conversation.id}: ${String(err)}`);
        return undefined;
      });
      const mediaMessage = await this.prisma.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          contactId: contact.id,
          senderId: verzAgent?.id ?? null,
          direction: 'OUTBOUND' as const,
          type: 'IMAGE' as const,
          status: simulated ? ('QUEUED' as const) : whatsappMessageId ? ('SENT' as const) : ('FAILED' as const),
          mediaUrl: effect.mediaUrl,
          mediaCaption: effect.caption,
          whatsappMessageId,
          whatsappNumberId: conversation.whatsappNumberId,
          sentAt: whatsappMessageId ? new Date() : undefined,
          metadata: { aiGenerated: true, productId: effect.productId, ...(simulated ? SIMULATED_MESSAGE_METADATA : {}) },
        },
        include: { sender: { select: { id: true, name: true, avatarUrl: true, isAiAgent: true } } },
      }).catch((err) => {
        this.logger.warn(`Failed to persist AI-triggered media message for conversation ${conversation.id}: ${String(err)}`);
        return null;
      });
      if (mediaMessage) this.realtimeService.emitNewMessage(tenantId, conversation.id, mediaMessage);
    }

    if (verzAgent && !assignedTo) {
      // Compare-and-set: a single UPDATE ... WHERE assigned_to_id IS NULL. `assignedTo`
      // is a snapshot from dispatch time, so a plain update here could silently
      // overwrite a human who took over since (reassigning the conversation to the AI).
      // With the condition in the WHERE, Postgres makes this atomic: if a human got
      // there first, count is 0 and nothing is written or emitted.
      const claimed = await this.prisma.conversation.updateMany({
        where: { id: conversation.id, tenantId, assignedToId: null },
        data: { assignedToId: verzAgent.id, status: 'OPEN' },
      }).catch((err) => {
        this.logger.warn(`Failed to self-assign conversation ${conversation.id}: ${String(err)}`);
        return null;
      });
      if (claimed && claimed.count > 0) {
        this.realtimeService.emitConversationUpdated(tenantId, conversation.id, {
          assignedTo: { id: verzAgent.id, name: verzAgent.name, avatarUrl: verzAgent.avatarUrl, isAiAgent: true },
          status: 'OPEN',
        });
      } else if (claimed) {
        this.logger.log(`AI self-assign skipped for conversation ${conversation.id}: it was assigned to someone else in the meantime.`);
      }
    }
    this.realtimeService.emitNewMessage(tenantId, conversation.id, aiMessage);
  }

  /**
   * Sends text the AI wrote and reports what happened, as the fields to store on its message row: the channel's
   * message id and SENT, or FAILED when the channel refused it. A refusal is never reported as a delivery, and is
   * never thrown, because the reply is already generated and paid for and the rest of the flow must still run.
   */
  private async sendAiText(
    tenantId: string,
    conversation: { id: string; whatsappNumberId?: string | null; channel?: { id: string; type: string } | null },
    contact: { id: string; phone: string | null; externalId?: string | null; externalIdType?: string | null },
    text: string,
  ): Promise<{ delivered: boolean; simulated?: boolean; fields: { status: MessageStatus; whatsappMessageId?: string; sentAt?: Date; failedAt?: Date; failureReason?: string } }> {
    // Simulation: the reply was generated but is deliberately not delivered. It is never reported as SENT.
    if (isSimulatedPhone(contact.phone)) return { delivered: false, simulated: true, fields: { status: MessageStatus.QUEUED } };
    try {
      const providerId = await this.dispatchOutbound(tenantId, conversation, contact, { kind: 'TEXT', text });
      return { delivered: true, fields: { status: MessageStatus.SENT, whatsappMessageId: providerId ?? undefined, sentAt: new Date() } };
    } catch (err) {
      this.logger.warn(`AI reply could not be delivered for conversation ${conversation.id}: ${err instanceof Error ? err.message : String(err)}`);
      return { delivered: false, fields: { status: MessageStatus.FAILED, failedAt: new Date(), failureReason: 'The channel did not accept this message.' } };
    }
  }

  private async runBotFlow(
    tenantId: string,
    conversation: { id: string; whatsappNumberId?: string | null; channel?: { id: string; type: string } | null },
    contact: { id: string; phone: string | null; externalId?: string | null; externalIdType?: string | null },
    rawNodes: FlowNode[] | Record<string, unknown>,
  ) {
    if (!rawNodes) return;
    const conversationId = conversation.id;
    const whatsappNumberId = conversation.whatsappNumberId;

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
            data: { tenantId, conversationId, contactId: contact.id, direction: MessageDirection.OUTBOUND, type: MessageType.TEXT, status: MessageStatus.QUEUED, content, whatsappNumberId },
          });
          // A simulated recipient gets no provider call and is not reported as sent.
          const simulatedRecipient = isSimulatedPhone(contact.phone);
          const waId = simulatedRecipient ? null : await this.dispatchOutbound(tenantId, conversation, contact, { kind: 'TEXT', text: content }).catch(() => null);
          const updated = await this.prisma.message.update({ where: { id: msg.id }, data: simulatedRecipient ? { metadata: SIMULATED_MESSAGE_METADATA } : { whatsappMessageId: waId ?? undefined, status: waId ? MessageStatus.SENT : MessageStatus.FAILED, sentAt: waId ? new Date() : undefined } });
          this.realtimeService.emitNewMessage(tenantId, conversationId, updated as unknown as Record<string, unknown>);
        } else if (node.type === 'image' && mediaUrl) {
          const msg = await this.prisma.message.create({
            data: { tenantId, conversationId, contactId: contact.id, direction: MessageDirection.OUTBOUND, type: MessageType.IMAGE, status: MessageStatus.QUEUED, mediaUrl, mediaCaption: content ?? null, whatsappNumberId },
          });
          // A simulated recipient gets no provider call and is not reported as sent.
          const simulatedRecipient = isSimulatedPhone(contact.phone);
          const waId = simulatedRecipient ? null : await this.dispatchOutbound(tenantId, conversation, contact, { kind: 'MEDIA', mediaType: MessageType.IMAGE, mediaUrl, caption: content }).catch(() => null);
          const updated = await this.prisma.message.update({ where: { id: msg.id }, data: simulatedRecipient ? { metadata: SIMULATED_MESSAGE_METADATA } : { whatsappMessageId: waId ?? undefined, status: waId ? MessageStatus.SENT : MessageStatus.FAILED, sentAt: waId ? new Date() : undefined } });
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
      include: { conversation: { include: { contact: true, channel: true } } },
    });
    // Reactions aren't wired up for WhatsApp Web (Baileys) or Messenger yet --
    // Messenger contacts have no phone so the check below already excludes
    // them; WhatsApp Web contacts do have a real phone, so its channel type
    // needs an explicit check here to avoid sending a Cloud-API reaction call
    // (wrong provider entirely) for a QR-connected conversation.
    if (msg?.whatsappMessageId && msg.conversation?.contact?.phone && msg.conversation.channel?.type !== 'WHATSAPP_WEB') {
      await this.whatsappService.sendReaction(tenantId, msg.conversation.contact.phone, msg.whatsappMessageId, emoji, msg.whatsappNumberId).catch(() => null);
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
      include: { conversation: { include: { contact: true, channel: true } } },
    });
    if (msg?.whatsappMessageId && msg.conversation?.contact?.phone && msg.conversation.channel?.type !== 'WHATSAPP_WEB') {
      await this.whatsappService.sendReaction(tenantId, msg.conversation.contact.phone, msg.whatsappMessageId, '', msg.whatsappNumberId).catch(() => null);
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

  /**
   * sendMessage() persists the provider id only AFTER the provider accepts the send, so a fast
   * receipt (WhatsApp Web acks within milliseconds) can arrive while the row has no
   * whatsappMessageId yet. Re-check a few times on the exact (tenantId, provider id) pair --
   * never a fuzzy match -- instead of dropping the receipt. Receipts for ids we never stored
   * (sent from the phone itself, other integrations) cost one bounded wait and are then ignored.
   */
  private async findMessageForReceipt(whatsappMessageId: string, tenantId: string) {
    for (let attempt = 0; ; attempt++) {
      const message = await this.prisma.message.findFirst({ where: { whatsappMessageId, tenantId } });
      if (message) return message;
      const delay = RECEIPT_LOOKUP_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) return null;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }

  /**
   * Delivered/read receipts from Messenger and Instagram. Meta reports delivery by message id and read by a time
   * watermark (Messenger) or the id of the last message seen (Instagram), so a read marks every earlier outbound
   * message of that conversation. Goes through updateStatus(), so ticks only ever move forward and the dashboard is
   * notified exactly as for WhatsApp.
   */
  async handleMetaReceipt(
    tenantId: string,
    channelId: string,
    customerId: string,
    platform: 'MESSENGER' | 'INSTAGRAM',
    status: typeof MessageStatus.DELIVERED | typeof MessageStatus.READ,
    receipt: { mids?: string[]; watermark?: number; mid?: string },
  ): Promise<void> {
    if (receipt.mids?.length) {
      for (const mid of receipt.mids) await this.updateStatus(mid, status, tenantId);
      return;
    }
    const contact = await this.prisma.contact.findFirst({
      where: { tenantId, externalIdType: platform === 'INSTAGRAM' ? 'INSTAGRAM_IGSID' : 'MESSENGER_PSID', externalId: customerId },
      select: { id: true },
    });
    if (!contact) return;

    let upTo: Date | null = receipt.watermark ? new Date(receipt.watermark) : null;
    if (!upTo && receipt.mid) {
      const seen = await this.prisma.message.findFirst({ where: { tenantId, whatsappMessageId: receipt.mid }, select: { createdAt: true } });
      upTo = seen?.createdAt ?? null;
    }
    if (!upTo) return;

    const earlier = status === MessageStatus.READ ? [MessageStatus.SENT, MessageStatus.DELIVERED] : [MessageStatus.SENT];
    const pending = await this.prisma.message.findMany({
      where: {
        tenantId, contactId: contact.id, direction: MessageDirection.OUTBOUND, status: { in: earlier },
        whatsappMessageId: { not: null }, createdAt: { lte: upTo }, conversation: { channelId },
      },
      select: { whatsappMessageId: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    for (const m of pending) await this.updateStatus(m.whatsappMessageId!, status, tenantId);
  }

  async updateStatus(
    whatsappMessageId: string,
    status: MessageStatus,
    tenantId: string,
    errors?: Array<{ code: number; title: string }>,
  ) {
    const message = await this.findMessageForReceipt(whatsappMessageId, tenantId);
    if (!message) return;
    if (!shouldApplyStatus(message.status, status)) return;

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
          sender: { select: { id: true, name: true, avatarUrl: true, isAiAgent: true } },
        },
      }),
      this.prisma.message.count({ where }),
    ]);

    return { data, meta: { total: Number(total), page, limit, pages: Math.ceil(Number(total) / limit) } };
  }
}
