import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateFlagDto {
  key: string;
  name: string;
  description?: string;
  enabled?: boolean;
  rolloutType?: string;
  rolloutPct?: number;
  betaTenants?: string[];
  environment?: string;
  category?: string;
}

export interface UpdateFlagDto {
  name?: string;
  description?: string;
  enabled?: boolean;
  rolloutType?: string;
  rolloutPct?: number;
  betaTenants?: string[];
  environment?: string;
  category?: string;
  killSwitch?: boolean;
}

@Injectable()
export class FeatureFlagsService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.featureFlag.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { rollouts: true } } },
    });
  }

  async create(dto: CreateFlagDto) {
    return this.prisma.featureFlag.create({
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled ?? false,
        rolloutType: dto.rolloutType ?? 'all',
        rolloutPct: dto.rolloutPct ?? 100,
        betaTenants: dto.betaTenants ?? [],
        environment: dto.environment ?? 'all',
        category: dto.category,
      },
    });
  }

  async update(id: string, dto: UpdateFlagDto) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { id } });
    if (!flag) throw new NotFoundException('Feature flag not found');
    return this.prisma.featureFlag.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.prisma.featureFlag.delete({ where: { id } });
  }

  async getTenantRollouts(flagId: string) {
    return this.prisma.featureFlagRollout.findMany({
      where: { flagId },
      include: { tenant: { select: { id: true, name: true, plan: true } } },
    });
  }

  async setTenantRollout(flagId: string, tenantId: string, enabled: boolean) {
    return this.prisma.featureFlagRollout.upsert({
      where: { flagId_tenantId: { flagId, tenantId } },
      create: { flagId, tenantId, enabled },
      update: { enabled },
    });
  }

  async removeTenantRollout(flagId: string, tenantId: string) {
    await this.prisma.featureFlagRollout.deleteMany({ where: { flagId, tenantId } });
  }

  // Evaluate all flags for a tenant — used by frontend to get feature access
  async getForTenant(tenantId: string): Promise<Record<string, boolean>> {
    const flags = await this.prisma.featureFlag.findMany({
      include: { rollouts: { where: { tenantId } } },
    });
    const result: Record<string, boolean> = {};
    for (const flag of flags) {
      result[flag.key] = this.evaluate(flag, flag.rollouts[0] ?? null, tenantId);
    }
    return result;
  }

  async isEnabled(key: string, tenantId?: string): Promise<boolean> {
    const flag = await this.prisma.featureFlag.findUnique({
      where: { key },
      include: tenantId ? { rollouts: { where: { tenantId } } } : undefined,
    });
    if (!flag) return false;
    return this.evaluate(
      flag,
      tenantId ? ((flag as typeof flag & { rollouts?: { enabled: boolean }[] }).rollouts?.[0] ?? null) : null,
      tenantId ?? '',
    );
  }

  private evaluate(
    flag: { enabled: boolean; killSwitch: boolean; rolloutType: string; rolloutPct: number; betaTenants: string[]; key: string },
    rollout: { enabled: boolean } | null,
    tenantId: string,
  ): boolean {
    if (flag.killSwitch || !flag.enabled) return false;
    if (flag.rolloutType === 'all') return true;
    if (rollout !== null) return rollout.enabled;
    if (flag.rolloutType === 'tenants') return flag.betaTenants.includes(tenantId);
    if (flag.rolloutType === 'percentage') {
      return this.stableHash(tenantId + flag.key) < flag.rolloutPct;
    }
    return false;
  }

  private stableHash(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return Math.abs(h) % 100;
  }
}
