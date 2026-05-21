import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateVersionDto {
  version: string;
  channel?: string;
  description?: string;
  changelog?: {
    features?: string[];
    improvements?: string[];
    fixes?: string[];
    breaking?: string[];
    security?: string[];
  };
  isLatest?: boolean;
}

export interface LogDeploymentDto {
  version: string;
  commitHash?: string;
  branch?: string;
  environment?: string;
  deployedBy?: string;
  status?: string;
  notes?: string;
  buildDuration?: number;
}

@Injectable()
export class ReleaseService {
  constructor(private prisma: PrismaService) {}

  async getCurrentVersion() {
    return this.prisma.appVersion.findFirst({
      where: { isLatest: true },
      orderBy: { releasedAt: 'desc' },
    });
  }

  listVersions() {
    return this.prisma.appVersion.findMany({
      orderBy: [{ major: 'desc' }, { minor: 'desc' }, { patch: 'desc' }],
      include: { _count: { select: { deployments: true } } },
    });
  }

  async createVersion(dto: CreateVersionDto) {
    const parts = dto.version.split('.').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
      throw new Error('Invalid semver format — use MAJOR.MINOR.PATCH');
    }
    if (dto.isLatest) {
      await this.prisma.appVersion.updateMany({ where: { isLatest: true }, data: { isLatest: false } });
    }
    return this.prisma.appVersion.create({
      data: {
        version: dto.version,
        major: parts[0]!,
        minor: parts[1]!,
        patch: parts[2]!,
        channel: dto.channel ?? 'stable',
        description: dto.description,
        changelog: dto.changelog ?? {},
        isLatest: dto.isLatest ?? false,
      },
    });
  }

  async updateVersion(id: string, dto: Partial<CreateVersionDto>) {
    const v = await this.prisma.appVersion.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('Version not found');
    if (dto.isLatest) {
      await this.prisma.appVersion.updateMany({ where: { isLatest: true }, data: { isLatest: false } });
    }
    return this.prisma.appVersion.update({
      where: { id },
      data: {
        channel: dto.channel,
        description: dto.description,
        changelog: dto.changelog as object | undefined,
        isLatest: dto.isLatest,
      },
    });
  }

  async logDeployment(dto: LogDeploymentDto) {
    const version = await this.prisma.appVersion.findUnique({ where: { version: dto.version } }).catch(() => null);
    return this.prisma.deploymentLog.create({
      data: {
        version: dto.version,
        versionId: version?.id,
        commitHash: dto.commitHash,
        branch: dto.branch,
        environment: dto.environment ?? 'production',
        deployedBy: dto.deployedBy,
        status: dto.status ?? 'success',
        finishedAt: new Date(),
        notes: dto.notes,
        buildDuration: dto.buildDuration,
      },
    });
  }

  listDeployments(environment?: string) {
    return this.prisma.deploymentLog.findMany({
      where: environment ? { environment } : undefined,
      orderBy: { startedAt: 'desc' },
      take: 100,
      include: { appVersion: { select: { version: true, channel: true } } },
    });
  }
}
