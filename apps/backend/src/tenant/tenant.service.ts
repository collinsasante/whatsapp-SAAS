import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppNumbersService } from '../whatsapp-numbers/whatsapp-numbers.service';
import { UpdateTenantDto, UpdateTenantSettingsDto } from './dto/update-tenant.dto';

@Injectable()
export class TenantService {
  constructor(
    private prisma: PrismaService,
    private whatsAppNumbers: WhatsAppNumbersService,
  ) {}

  async findById(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { settings: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async update(tenantId: string, dto: UpdateTenantDto) {
    // WhatsApp credentials go through WhatsAppNumbersService (single write
    // path -- encrypts the token, links/creates the Channel row, audit-logs)
    // instead of being written onto Tenant/Channel directly here, which is
    // what this "legacy quick-save" path used to do independently of the
    // dedicated /whatsapp-numbers and /channels write paths.
    const { phoneNumberId, wabaId, accessToken, ...rest } = dto;

    // Caller is allowed to send just one of these three fields (e.g. "paste a
    // fresh access token" without re-entering phoneNumberId/wabaId) -- a
    // previous version of this sync only fired when all three were present
    // together, which silently let WhatsAppNumber.accessToken go stale on
    // any single-field update and broke real sends once WhatsAppNumber
    // became the thing actually used to send. Merge with the tenant's
    // current values first so any partial update still keeps the linked
    // WhatsAppNumber row in sync.
    const existing = (phoneNumberId || wabaId || accessToken)
      ? await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })
      : null;

    await this.prisma.tenant.update({ where: { id: tenantId }, data: rest });

    if (existing) {
      const mergedPhoneNumberId = phoneNumberId ?? existing.phoneNumberId;
      const mergedWabaId = wabaId ?? existing.wabaId;
      const mergedAccessToken = accessToken ?? existing.accessToken;
      if (mergedPhoneNumberId && mergedWabaId && mergedAccessToken) {
        await this.whatsAppNumbers.upsertByPhoneNumberId(tenantId, {
          phoneNumberId: mergedPhoneNumberId, wabaId: mergedWabaId, accessToken: mergedAccessToken,
        });
      }
    }

    return this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  }

  async updateSettings(tenantId: string, dto: UpdateTenantSettingsDto) {
    return this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...dto },
      update: dto,
    });
  }

  async updateOnboarding(tenantId: string, data: {
    step?: number;
    completed?: boolean;
    industry?: string;
    teamSize?: string;
    country?: string;
    logoUrl?: string;
    businessCategory?: string;
    businessDescription?: string;
    businessAddress?: string;
    businessWebsite?: string;
    phoneNumberId?: string;
    wabaId?: string;
    accessToken?: string;
    plan?: string;
  }) {
    const { phoneNumberId, wabaId, accessToken, ...rest } = data;

    // Same merge-with-existing-values rationale as update() above -- see its
    // comment for why a strict "all three or none" guard silently let
    // WhatsAppNumber.accessToken go stale on a partial update.
    const existing = (phoneNumberId || wabaId || accessToken)
      ? await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })
      : null;

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(rest.step !== undefined && { onboardingStep: rest.step }),
        ...(rest.completed !== undefined && { onboardingCompleted: rest.completed }),
        ...(rest.industry && { industry: rest.industry }),
        ...(rest.teamSize && { teamSize: rest.teamSize }),
        ...(rest.country && { country: rest.country }),
        ...(rest.logoUrl && { logoUrl: rest.logoUrl }),
        ...(rest.businessCategory && { businessCategory: rest.businessCategory }),
        ...(rest.businessDescription !== undefined && { businessDescription: rest.businessDescription }),
        ...(rest.businessAddress !== undefined && { businessAddress: rest.businessAddress }),
        ...(rest.businessWebsite !== undefined && { businessWebsite: rest.businessWebsite }),
        ...(rest.plan && { plan: rest.plan }),
      },
    });

    // Same WhatsAppNumbersService delegation as update() above -- onboarding
    // is the other place a tenant can set WhatsApp credentials directly.
    if (existing) {
      const mergedPhoneNumberId = phoneNumberId ?? existing.phoneNumberId;
      const mergedWabaId = wabaId ?? existing.wabaId;
      const mergedAccessToken = accessToken ?? existing.accessToken;
      if (mergedPhoneNumberId && mergedWabaId && mergedAccessToken) {
        await this.whatsAppNumbers.upsertByPhoneNumberId(tenantId, {
          phoneNumberId: mergedPhoneNumberId, wabaId: mergedWabaId, accessToken: mergedAccessToken,
        });
      }
    }

    return this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  }

  async getStats(tenantId: string) {
    const [contacts, conversations, messages, campaigns] = await Promise.all([
      this.prisma.contact.count({ where: { tenantId } }),
      this.prisma.conversation.count({ where: { tenantId } }),
      this.prisma.message.count({ where: { tenantId } }),
      this.prisma.campaign.count({ where: { tenantId } }),
    ]);
    return { contacts, conversations, messages, campaigns };
  }
}
