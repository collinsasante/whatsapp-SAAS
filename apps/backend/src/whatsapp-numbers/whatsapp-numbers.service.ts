import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialsEncryptionService } from '../common/crypto/credentials-encryption.service';
import { AuditService } from '../audit/audit.service';
import { CreateWhatsAppNumberDto, UpdateWhatsAppNumberDto } from './dto/whatsapp-number.dto';
import { mapWhatsAppErrorCode, FailureCategory } from '../common/utils/whatsapp-error.util';
import { Prisma } from '@prisma/client';

// Kept in sync with WhatsAppService.graphBaseUrl -- this file makes its own
// direct Graph API call for testConnection() rather than depending on
// WhatsAppService, since neither module currently imports the other and a
// single read-only status-check call isn't worth introducing that coupling.
const GRAPH_API_BASE = 'https://graph.facebook.com/v23.0';

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

export type WhatsAppNumberStatus = 'CONNECTED' | 'NEEDS_ATTENTION' | 'DISCONNECTED';

type PublicNumber = Prisma.WhatsAppNumberGetPayload<{ select: typeof PUBLIC_SELECT }>;

/**
 * Computed, not a stored enum -- avoids a second source of truth that could
 * drift from isActive/lastError. DISCONNECTED wins over any lingering error
 * (a disconnected number's old error is no longer the actionable fact);
 * NEEDS_ATTENTION covers both an explicit testConnection() failure and a
 * real send failure recorded elsewhere, since from the user's perspective
 * both mean "this number needs a look" with no meaningful behavioral
 * difference between them.
 */
function computeStatus(num: Pick<PublicNumber, 'isActive' | 'lastError'>): WhatsAppNumberStatus {
  if (!num.isActive) return 'DISCONNECTED';
  if (num.lastError) return 'NEEDS_ATTENTION';
  return 'CONNECTED';
}

function withStatus<T extends Pick<PublicNumber, 'isActive' | 'lastError'>>(num: T): T & { status: WhatsAppNumberStatus } {
  return { ...num, status: computeStatus(num) };
}

@Injectable()
export class WhatsAppNumbersService {
  private readonly logger = new Logger(WhatsAppNumbersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialsEncryptionService,
    private readonly audit: AuditService,
  ) {}

  async findAll(tenantId: string) {
    const numbers = await this.prisma.whatsAppNumber.findMany({
      where: { tenantId },
      select: PUBLIC_SELECT,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return numbers.map(withStatus);
  }

  async findOne(tenantId: string, id: string) {
    const num = await this.prisma.whatsAppNumber.findFirst({ where: { id, tenantId }, select: PUBLIC_SELECT });
    if (!num) throw new NotFoundException('WhatsApp number not found');
    return withStatus(num);
  }

  async create(tenantId: string, dto: CreateWhatsAppNumberDto, actorId?: string) {
    const existing = await this.prisma.whatsAppNumber.findUnique({
      where: { tenantId_phoneNumberId: { tenantId, phoneNumberId: dto.phoneNumberId } },
    });
    if (existing) {
      throw new ConflictException(`Phone number ID ${dto.phoneNumberId} is already registered for this workspace`);
    }

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

    return this.findOne(tenantId, created.id);
  }

  async update(tenantId: string, id: string, dto: UpdateWhatsAppNumberDto, actorId?: string) {
    await this.findOne(tenantId, id); // existence + tenant-ownership check

    const updated = await this.applyPatch(tenantId, id, dto, {});

    void this.audit.log({
      tenantId, userId: actorId, action: 'UPDATE', resource: 'whatsapp_number', resourceId: id,
      metadata: { changes: Object.keys(dto).filter((k) => k !== 'accessToken') },
    });

    return withStatus(updated);
  }

  /**
   * Re-activates a disconnected number, optionally alongside a credential
   * update (the common real case: a token expired, disconnect happened,
   * paste a fresh one to bring it back). Distinct from update() so it always
   * forces isActive:true and clears any recorded error regardless of what's
   * in dto, and gets its own audit action for a clear history.
   */
  async reconnect(tenantId: string, id: string, dto: UpdateWhatsAppNumberDto, actorId?: string) {
    await this.findOne(tenantId, id);

    const updated = await this.applyPatch(tenantId, id, dto, {
      isActive: true,
      lastError: null,
      lastErrorAt: null,
    });

    void this.audit.log({
      tenantId, userId: actorId, action: 'UPDATE', resource: 'whatsapp_number', resourceId: id,
      metadata: { action: 'RECONNECT', changes: Object.keys(dto).filter((k) => k !== 'accessToken') },
    });

    return withStatus(updated);
  }

  /**
   * Calls Meta's Graph API with this number's stored (decrypted) token to
   * confirm it's actually still valid, rather than waiting for it to fail
   * silently on the next real send. Updates lastError/lastErrorAt so the
   * computed status (and the next real send, which surfaces the same
   * lastError) reflects the result; success clears any prior error.
   */
  async testConnection(tenantId: string, id: string, actorId?: string) {
    const num = await this.prisma.whatsAppNumber.findFirst({ where: { id, tenantId } });
    if (!num) throw new NotFoundException('WhatsApp number not found');

    const accessToken = this.encryption.decrypt(num.accessToken);

    try {
      await axios.get(`${GRAPH_API_BASE}/${num.phoneNumberId}`, {
        params: { fields: 'verified_name' },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15_000,
      });

      await this.prisma.whatsAppNumber.update({ where: { id }, data: { lastError: null, lastErrorAt: null } });

      void this.audit.log({
        tenantId, userId: actorId, action: 'UPDATE', resource: 'whatsapp_number', resourceId: id,
        metadata: { action: 'TEST_CONNECTION', result: 'success' },
      });

      return { success: true as const };
    } catch (error) {
      const message = this.describeMetaError(error);
      const category = this.categorizeMetaError(error);

      await this.prisma.whatsAppNumber.update({ where: { id }, data: { lastError: message, lastErrorAt: new Date() } });

      this.logger.warn(`Test connection failed for WhatsAppNumber ${id}: ${message}`);
      void this.audit.log({
        tenantId, userId: actorId, action: 'UPDATE', resource: 'whatsapp_number', resourceId: id,
        metadata: { action: 'TEST_CONNECTION', result: 'failure', category },
      });

      return { success: false as const, error: message, category };
    }
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

    return withStatus(updated);
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
   * Shared write path for update() and reconnect() -- both patch the same
   * set of DTO fields and both need to keep Tenant in sync when the default
   * number's identity/token changes; extraData lets each caller force its
   * own additional fields (reconnect forces isActive/lastError) without
   * duplicating the conflict-check + sync logic.
   */
  private async applyPatch(
    tenantId: string,
    id: string,
    dto: UpdateWhatsAppNumberDto,
    extraData: Partial<Prisma.WhatsAppNumberUpdateInput>,
  ) {
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
        ...extraData,
      },
      select: PUBLIC_SELECT,
    });

    // Keep tenant creds in sync if this is the default number
    if (updated.isDefault && (dto.phoneNumberId || dto.wabaId || dto.accessToken)) {
      const full = await this.prisma.whatsAppNumber.findUniqueOrThrow({ where: { id } });
      await this.syncDefaultToTenant(tenantId, full.phoneNumberId, full.wabaId, this.encryption.decrypt(full.accessToken));
    }

    return updated;
  }

  private describeMetaError(error: unknown): string {
    if (error instanceof AxiosError && error.response) {
      const data = error.response.data as { error?: { message?: string; error_user_msg?: string } };
      return data?.error?.error_user_msg ?? data?.error?.message ?? JSON.stringify(data);
    }
    return error instanceof Error ? error.message : String(error);
  }

  private categorizeMetaError(error: unknown): FailureCategory {
    if (error instanceof AxiosError && error.response) {
      const data = error.response.data as { error?: { code?: number } };
      return mapWhatsAppErrorCode(data?.error?.code);
    }
    return 'other';
  }

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
  ) {
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
