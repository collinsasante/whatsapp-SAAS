import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateTenantDto, UpdateTenantSettingsDto } from './dto/update-tenant.dto';

@Injectable()
export class TenantService {
  constructor(private prisma: PrismaService) {}

  async findById(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { settings: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async update(tenantId: string, dto: UpdateTenantDto) {
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: dto,
    });
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
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(data.step !== undefined && { onboardingStep: data.step }),
        ...(data.completed !== undefined && { onboardingCompleted: data.completed }),
        ...(data.industry && { industry: data.industry }),
        ...(data.teamSize && { teamSize: data.teamSize }),
        ...(data.country && { country: data.country }),
        ...(data.logoUrl && { logoUrl: data.logoUrl }),
        ...(data.businessCategory && { businessCategory: data.businessCategory }),
        ...(data.businessDescription !== undefined && { businessDescription: data.businessDescription }),
        ...(data.businessAddress !== undefined && { businessAddress: data.businessAddress }),
        ...(data.businessWebsite !== undefined && { businessWebsite: data.businessWebsite }),
        ...(data.phoneNumberId && { phoneNumberId: data.phoneNumberId }),
        ...(data.wabaId && { wabaId: data.wabaId }),
        ...(data.accessToken && { accessToken: data.accessToken }),
        ...(data.plan && { plan: data.plan }),
      },
    });
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
