import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// MAJOR.MINOR.PATCH with an optional -prerelease tag, e.g. 1.3.0-beta.1 --
// must match ReleaseAdminController's SEMVER_PATTERN in release.dto.ts.
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

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
    // split('.').map(Number) previously rejected any prerelease suffix
    // (e.g. "1.3.0-beta.1" splits into 4 dot-separated parts, not 3) --
    // this app's versioning policy explicitly requires prerelease support.
    const match = SEMVER_PATTERN.exec(dto.version);
    if (!match) {
      throw new BadRequestException('Invalid semver format — use MAJOR.MINOR.PATCH, optionally with a -prerelease tag (e.g. 1.3.0-beta.1)');
    }
    const existing = await this.prisma.appVersion.findUnique({ where: { version: dto.version } });
    if (existing) {
      throw new BadRequestException(`Version ${dto.version} already exists`);
    }
    if (dto.isLatest) {
      await this.prisma.appVersion.updateMany({ where: { isLatest: true }, data: { isLatest: false } });
    }
    return this.prisma.appVersion.create({
      data: {
        version: dto.version,
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
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
