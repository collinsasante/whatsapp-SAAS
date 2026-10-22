import {
  Logger,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialsEncryptionService } from '../common/crypto/credentials-encryption.service';
import { AuditService } from '../audit/audit.service';
import { CreateWhatsAppNumberDto, UpdateWhatsAppNumberDto } from './dto/whatsapp-number.dto';
import { Prisma } from '@prisma/client';

const GRAPH_API_BASE = 'https://graph.facebook.com/v23.0';

export interface WebhookSubscriptionResult {
  subscribed: boolean;
  /** Meta's own explanation when subscribed is false. */
  reason?: string;
}

// Fields never returned to the frontend -- accessToken is write-only from the
// API's perspective (the settings/channels UI already treats it that way:
// edit forms always start blank with a "leave blank to keep existing"
// placeholder, they never pre-fill it from a prior response).
const PUBLIC_SELECT = {
  id: true,
  tenantId: true,
  channelId: true,
  label: true,
  phoneNumberId: true,
  wabaId: true,
  isDefault: true,
  isActive: true,
  qualityRating: true,
  messagingLimitTier: true,
  qualitySyncedAt: true,
  lastError: true,
  lastErrorAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WhatsAppNumberSelect;

@Injectable()
export class WhatsAppNumbersService {
  private readonly logger = new Logger(WhatsAppNumbersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialsEncryptionService,
    private readonly audit: AuditService,
  ) {}

  async findAll(tenantId: string) {
    return this.prisma.whatsAppNumber.findMany({
      where: { tenantId },
      select: PUBLIC_SELECT,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(tenantId: string, id: string) {
    const num = await this.prisma.whatsAppNumber.findFirst({ where: { id, tenantId }, select: PUBLIC_SELECT });
    if (!num) throw new NotFoundException('WhatsApp number not found');
    return num;
  }

  async create(tenantId: string, dto: CreateWhatsAppNumberDto, actorId?: string) {
    const existing = await this.prisma.whatsAppNumber.findUnique({
      where: { tenantId_phoneNumberId: { tenantId, phoneNumberId: dto.phoneNumberId } },
    });
    if (existing) {
      throw new ConflictException(`Phone number ID ${dto.phoneNumberId} is already registered for this workspace`);
    }

    // Best effort, and never a reason to refuse the save: a token that can send messages but is not allowed to manage
    // webhook subscriptions must still be storable. The outcome is returned so the screen can warn the user.
    const webhookSubscription = await this.trySubscribeAppToWaba(dto.wabaId, dto.accessToken);

    // First number created is auto-default
    const count = await this.prisma.whatsAppNumber.count({ where: { tenantId } });
    const isDefault = dto.isDefault ?? count === 0;

    if (isDefault) {
      await this.clearDefault(tenantId);
    }

    const created = await this.prisma.whatsAppNumber.create({
      data: {
        tenantId,
        label: dto.label,
        phoneNumberId: dto.phoneNumberId,
        wabaId: dto.wabaId,
        accessToken: this.encryption.encrypt(dto.accessToken),
        isDefault,
      },
    });

    await this.linkChannel(tenantId, created.id, dto.label);

    if (isDefault) {
      await this.syncDefaultToTenant(tenantId, dto.phoneNumberId, dto.wabaId, dto.accessToken);
    }

    void this.audit.log({
      tenantId, userId: actorId, action: 'CREATE', resource: 'whatsapp_number', resourceId: created.id,
      metadata: { label: created.label, phoneNumberId: created.phoneNumberId, isDefault },
    });

    return { ...(await this.findOne(tenantId, created.id)), webhookSubscription };
  }

  async update(tenantId: string, id: string, dto: UpdateWhatsAppNumberDto, actorId?: string) {
    await this.findOne(tenantId, id); // existence + tenant-ownership check

    if (dto.phoneNumberId) {
      const conflict = await this.prisma.whatsAppNumber.findFirst({
        where: { tenantId, phoneNumberId: dto.phoneNumberId, NOT: { id } },
      });
      if (conflict) {
        throw new ConflictException(`Phone number ID ${dto.phoneNumberId} is already registered for this workspace`);
      }
    }

    const updated = await this.prisma.whatsAppNumber.update({
      where: { id },
      data: {
        ...(dto.label         !== undefined && { label:         dto.label }),
        ...(dto.phoneNumberId !== undefined && { phoneNumberId: dto.phoneNumberId }),
        ...(dto.wabaId        !== undefined && { wabaId:        dto.wabaId }),
        ...(dto.accessToken   !== undefined && { accessToken:   this.encryption.encrypt(dto.accessToken) }),
        ...(dto.isActive      !== undefined && { isActive:      dto.isActive }),
      },
      select: PUBLIC_SELECT,
    });

    let webhookSubscription: WebhookSubscriptionResult | undefined;
    if (dto.phoneNumberId !== undefined || dto.wabaId !== undefined || dto.accessToken !== undefined) {
      const full = await this.prisma.whatsAppNumber.findUniqueOrThrow({ where: { id } });
      const decryptedToken = this.encryption.decrypt(full.accessToken);

      // Re-subscribe on a WABA/token change so a number that was working does not silently stop receiving webhooks after
      // an edit. Best effort: a refusal from Meta must not stop the credentials below from being synced to the tenant.
      if (dto.wabaId !== undefined || dto.accessToken !== undefined) {
        webhookSubscription = await this.trySubscribeAppToWaba(full.wabaId, decryptedToken);
      }

      // Keep tenant creds in sync if this is the default number
      if (updated.isDefault) {
        await this.syncDefaultToTenant(tenantId, full.phoneNumberId, full.wabaId, decryptedToken);
      }
    }

    void this.audit.log({
      tenantId, userId: actorId, action: 'UPDATE', resource: 'whatsapp_number', resourceId: id,
      metadata: { changes: Object.keys(dto).filter((k) => k !== 'accessToken') },
    });

    return webhookSubscription ? { ...updated, webhookSubscription } : updated;
  }

  async setDefault(tenantId: string, id: string, actorId?: string) {
    const num = await this.findOne(tenantId, id);
    if (!num.isActive) {
      throw new BadRequestException('Cannot set an inactive number as default');
    }

    await this.clearDefault(tenantId);

    const updated = await this.prisma.whatsAppNumber.update({
      where: { id },
      data: { isDefault: true },
      select: PUBLIC_SELECT,
    });

    const full = await this.prisma.whatsAppNumber.findUniqueOrThrow({ where: { id } });
    await this.syncDefaultToTenant(tenantId, full.phoneNumberId, full.wabaId, this.encryption.decrypt(full.accessToken));

    void this.audit.log({
      tenantId, userId: actorId, action: 'UPDATE', resource: 'whatsapp_number', resourceId: id,
      metadata: { action: 'SET_DEFAULT' },
    });

    return updated;
  }

  /**
   * Soft-disconnect, not a hard delete -- WhatsAppNumber.id is referenced by
   * Conversation.whatsappNumberId/Message.whatsappNumberId (onDelete:
   * SetNull), so deleting the row would silently erase historical channel
   * attribution for every past conversation/message on this number. A
   * disconnected number keeps its row, its id, and its history; it's just
   * no longer eligible for routing (isActive: false).
   */
  async remove(tenantId: string, id: string, actorId?: string) {
    const num = await this.findOne(tenantId, id);

    await this.prisma.whatsAppNumber.update({
      where: { id },
      data: { isDefault: false, isActive: false },
    });

    if (num.isDefault) {
      const nextDefault = await this.prisma.whatsAppNumber.findFirst({
        where: { tenantId, isActive: true, NOT: { id } },
        orderBy: { createdAt: 'asc' },
      });
      if (nextDefault) {
        await this.prisma.whatsAppNumber.update({ where: { id: nextDefault.id }, data: { isDefault: true } });
        await this.syncDefaultToTenant(tenantId, nextDefault.phoneNumberId, nextDefault.wabaId, this.encryption.decrypt(nextDefault.accessToken));
      }
    }

    void this.audit.log({
      tenantId, userId: actorId, action: 'DELETE', resource: 'whatsapp_number', resourceId: id,
      metadata: { label: num.label, phoneNumberId: num.phoneNumberId },
    });

    return { success: true };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Links a newly-created WhatsAppNumber to a generic Channel row so it
   * shows up correctly wherever the platform-agnostic Channel abstraction is
   * used (Conversation.channelId, the Channels UI). Reuses an existing
   * unclaimed WHATSAPP-type Channel for the tenant where one exists (the
   * common case -- e.g. one already created via the legacy /channels flow),
   * creating a new one otherwise, with the same collision-avoided naming as
   * the one-off Phase 1 migration backfill that did this for pre-existing
   * rows -- this is that same logic applied live, for numbers created from
   * now on.
   */
  private async linkChannel(tenantId: string, whatsAppNumberId: string, label: string): Promise<string> {
    const existingChannel = await this.prisma.channel.findFirst({
      where: { tenantId, type: 'WHATSAPP', whatsAppNumber: null },
      orderBy: { createdAt: 'asc' },
    });

    if (existingChannel) {
      await this.prisma.whatsAppNumber.update({ where: { id: whatsAppNumberId }, data: { channelId: existingChannel.id } });
      return existingChannel.id;
    }

    let candidateName = label;
    let suffix = 1;
    while (await this.prisma.channel.findFirst({ where: { tenantId, type: 'WHATSAPP', name: candidateName } })) {
      suffix += 1;
      candidateName = `${label} ${suffix}`;
    }

    const channel = await this.prisma.channel.create({
      data: { tenantId, type: 'WHATSAPP', name: candidateName, isActive: true, credentials: {}, metadata: {} },
    });
    await this.prisma.whatsAppNumber.update({ where: { id: whatsAppNumberId }, data: { channelId: channel.id } });
    return channel.id;
  }

  /**
   * A correctly configured app-level webhook (Callback URL + verify token + subscribed fields, all set in the Meta
   * Dashboard) is not sufficient on its own: Meta also wants this app subscribed to each WhatsApp Business Account.
   * This asks Meta to do that. It never throws and never logs the token. A failure is returned, not raised, because
   * a token can be perfectly good for sending messages and still be refused here.
   */
  private async trySubscribeAppToWaba(wabaId: string, accessToken: string): Promise<WebhookSubscriptionResult> {
    try {
      const res = await fetch(`${GRAPH_API_BASE}/${wabaId}/subscribed_apps`, {
        method: 'POST',
        body: new URLSearchParams({ access_token: accessToken }),
      });
      const data = (await res.json()) as { success?: boolean; error?: { message?: string } };
      if (data.success) return { subscribed: true };
      const reason = data.error?.message ?? 'Meta did not confirm the subscription';
      this.logger.warn(`Could not subscribe the app to WhatsApp Business Account ${wabaId}: ${reason}`);
      return { subscribed: false, reason };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Could not reach Meta';
      this.logger.warn(`Could not subscribe the app to WhatsApp Business Account ${wabaId}: ${reason}`);
      return { subscribed: false, reason };
    }
  }

  private async clearDefault(tenantId: string) {
    await this.prisma.whatsAppNumber.updateMany({
      where: { tenantId, isDefault: true },
      data: { isDefault: false },
    });
  }

  private async syncDefaultToTenant(
    tenantId: string,
    phoneNumberId: string,
    wabaId: string,
    accessToken: string,
  ) {
    // Legacy denormalized fields on Tenant -- still read as a fallback by
    // WhatsAppService.resolveCredentials() when no WhatsAppNumber-specific
    // resolution is available, so kept in sync here rather than removed.
    // Stored in plaintext deliberately: Tenant.accessToken predates this
    // encryption layer and every legacy read site expects plaintext; migrating
    // it is out of scope here since WhatsAppNumber is the actual source of
    // truth going forward (see Phase 3).
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { phoneNumberId, wabaId, accessToken },
    });
  }

  /**
   * Upsert-by-phoneNumberId, used only by TenantService's legacy quick-save
   * paths (tenant.update/updateOnboarding), where the caller doesn't know or
   * care whether a WhatsAppNumber row already exists for this number --
   * unlike create(), which intentionally throws on a duplicate phoneNumberId
   * for the real "add a number" API (POST /whatsapp-numbers), where that's a
   * genuine user-facing validation error.
   */
  async upsertByPhoneNumberId(
    tenantId: string,
    data: { phoneNumberId: string; wabaId: string; accessToken: string },
    actorId?: string,
  ): Promise<{ id: string; webhookSubscription?: WebhookSubscriptionResult }> {
    const existing = await this.prisma.whatsAppNumber.findUnique({
      where: { tenantId_phoneNumberId: { tenantId, phoneNumberId: data.phoneNumberId } },
    });
    if (existing) {
      return this.update(tenantId, existing.id, { wabaId: data.wabaId, accessToken: data.accessToken }, actorId);
    }
    return this.create(tenantId, { label: 'Default', ...data }, actorId);
  }

  // ─── Internal use (credential resolution -- never expose these results directly) ──

  /** Decrypted credentials for the tenant's default number, or null if none. Internal use only -- never return this object from a controller. */
  async getDefaultForTenant(tenantId: string) {
    const num = await this.prisma.whatsAppNumber.findFirst({
      where: { tenantId, isDefault: true, isActive: true },
    });
    if (!num) return null;
    return { ...num, accessToken: this.encryption.decrypt(num.accessToken) };
  }

  /** Decrypted credentials for a specific number by id. Internal use only -- never return this object from a controller. */
  async getCredentials(tenantId: string, id: string) {
    const num = await this.prisma.whatsAppNumber.findFirst({ where: { id, tenantId } });
    if (!num) return null;
    return { ...num, accessToken: this.encryption.decrypt(num.accessToken) };
  }

  /** Decrypted credentials by Meta phone_number_id. Internal use only -- never return this object from a controller. */
  async getByPhoneNumberId(tenantId: string, phoneNumberId: string) {
    const num = await this.prisma.whatsAppNumber.findUnique({
      where: { tenantId_phoneNumberId: { tenantId, phoneNumberId } },
    });
    if (!num) return null;
    return { ...num, accessToken: this.encryption.decrypt(num.accessToken) };
  }
}
