import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RESPONDER_SYSTEM_BODY, RESPONDER_SYSTEM_TEMPLATE_KEY, RESPONDER_SYSTEM_TEMPLATE_NAME, RESPONDER_SYSTEM_VARIABLES, RESPONDER_SYSTEM_VERSION } from './seed/responder-system.v1';

const CACHE_TTL_MS = 60_000;

interface CachedVersion {
  id: string;
  templateId: string;
  version: string;
  body: string;
  variables: string[];
  cachedAt: number;
}

/**
 * Loads/renders the ACTIVE version of a prompt template, with a short
 * in-memory cache (matches FeatureFlagsService's isEnabledCached pattern) so
 * a hot inbound path doesn't hit the DB on every message. Also lazily ensures
 * the Phase 1 seed template exists -- self-healing rather than depending on a
 * separately-run seed script, matching the codebase's findOrCreate* convention.
 */
@Injectable()
export class PromptsService {
  private readonly logger = new Logger(PromptsService.name);
  private readonly cache = new Map<string, CachedVersion>();
  private seeded = false;

  constructor(private prisma: PrismaService) {}

  private async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    const existing = await this.prisma.aiPromptTemplate.findUnique({ where: { key: RESPONDER_SYSTEM_TEMPLATE_KEY } });
    if (!existing) {
      await this.prisma.aiPromptTemplate.create({
        data: {
          key: RESPONDER_SYSTEM_TEMPLATE_KEY,
          name: RESPONDER_SYSTEM_TEMPLATE_NAME,
          versions: {
            create: {
              version: RESPONDER_SYSTEM_VERSION,
              status: 'ACTIVE',
              body: RESPONDER_SYSTEM_BODY,
              variables: [...RESPONDER_SYSTEM_VARIABLES],
              activatedAt: new Date(),
              changeNote: 'Seeded: parity with the legacy AiResponderService system prompt.',
            },
          },
        },
      });
      this.logger.log(`Seeded default prompt template "${RESPONDER_SYSTEM_TEMPLATE_KEY}" v${RESPONDER_SYSTEM_VERSION}`);
    }
    this.seeded = true;
  }

  /** Loads the ACTIVE version of a template by key, cached for CACHE_TTL_MS. */
  async getActiveVersion(templateKey: string): Promise<CachedVersion> {
    await this.ensureSeeded();

    const cached = this.cache.get(templateKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached;

    const template = await this.prisma.aiPromptTemplate.findUnique({
      where: { key: templateKey },
      include: { versions: { where: { status: 'ACTIVE' }, take: 1 } },
    });
    const active = template?.versions[0];
    if (!active) {
      throw new NotFoundException(`No ACTIVE prompt version for template "${templateKey}"`);
    }

    const entry: CachedVersion = {
      id: active.id,
      templateId: active.templateId,
      version: active.version,
      body: active.body,
      variables: active.variables,
      cachedAt: Date.now(),
    };
    this.cache.set(templateKey, entry);
    return entry;
  }

  private invalidate(templateKey: string): void {
    this.cache.delete(templateKey);
  }

  listTemplates() {
    return this.prisma.aiPromptTemplate.findMany({ orderBy: { key: 'asc' } });
  }

  listVersions(templateId: string) {
    return this.prisma.aiPromptVersion.findMany({ where: { templateId }, orderBy: { createdAt: 'desc' } });
  }

  async createVersion(templateId: string, dto: { version: string; body: string; variables: string[]; changeNote?: string; createdById?: string }) {
    const template = await this.prisma.aiPromptTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new NotFoundException('Prompt template not found');
    return this.prisma.aiPromptVersion.create({
      data: {
        templateId,
        version: dto.version,
        body: dto.body,
        variables: dto.variables,
        changeNote: dto.changeNote,
        createdById: dto.createdById,
        status: 'DRAFT',
      },
    });
  }

  /** Transactionally archives the current ACTIVE version (if any) and activates this one. */
  async activateVersion(templateId: string, versionId: string) {
    const version = await this.prisma.aiPromptVersion.findFirst({ where: { id: versionId, templateId } });
    if (!version) throw new NotFoundException('Prompt version not found for this template');
    if (version.status === 'ARCHIVED') {
      throw new BadRequestException('Cannot re-activate an archived version -- create a new version from its body instead');
    }

    const template = await this.prisma.aiPromptTemplate.findUniqueOrThrow({ where: { id: templateId } });

    await this.prisma.$transaction([
      this.prisma.aiPromptVersion.updateMany({ where: { templateId, status: 'ACTIVE' }, data: { status: 'ARCHIVED' } }),
      this.prisma.aiPromptVersion.update({ where: { id: versionId }, data: { status: 'ACTIVE', activatedAt: new Date() } }),
    ]);

    this.invalidate(template.key);
    return this.prisma.aiPromptVersion.findUniqueOrThrow({ where: { id: versionId } });
  }
}
