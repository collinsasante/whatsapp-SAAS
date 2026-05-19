import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class ManageSettingsService {
  constructor(private prisma: PrismaService) {}

  async get(tenantId: string) {
    return this.prisma.tenantSettings.findUnique({ where: { tenantId } });
  }

  async updateWelcome(tenantId: string, data: { welcomeEnabled?: boolean; welcomeMessage?: string }) {
    return this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
  }

  async updateOffHours(tenantId: string, data: {
    offHoursEnabled?: boolean;
    offHoursMessage?: string;
    offHoursSchedule?: Prisma.InputJsonValue;
  }) {
    return this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
  }

  async updateOptInOut(tenantId: string, data: {
    optOutKeywords?: string[];
    optInKeywords?: string[];
    optOutReply?: string;
    optInReply?: string;
  }) {
    return this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
  }

  async updateWidget(tenantId: string, data: {
    widgetEnabled?: boolean;
    widgetConfig?: Prisma.InputJsonValue;
  }) {
    return this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
  }

  async updateAi(tenantId: string, data: {
    aiEnabled?: boolean;
    aiAlwaysOn?: boolean;
    aiPersonality?: string;
  }) {
    return this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
  }
}
