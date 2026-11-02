import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { containsRetiredScript } from './retired-wording';
import {
  RESPONDER_SYSTEM_BODY, RESPONDER_SYSTEM_BODY_V1_0_0, RESPONDER_SYSTEM_BODY_V1_1_0_MD5, RESPONDER_SYSTEM_BODY_V1_2_0, RESPONDER_SYSTEM_CHANGE_NOTE, RESPONDER_SYSTEM_TEMPLATE_KEY,
  RESPONDER_SYSTEM_TEMPLATE_NAME, RESPONDER_SYSTEM_VARIABLES, RESPONDER_SYSTEM_VERSION,
} from './seed/responder-system.v1';

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
  private readonly warnedRetired = new Set<string>();

  constructor(private prisma: PrismaService) {}

  private async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    const existing = await this.prisma.aiPromptTemplate.findUnique({
      where: { key: RESPONDER_SYSTEM_TEMPLATE_KEY },
      include: { versions: { where: { status: 'ACTIVE' }, take: 1 } },
    });
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
    } else {
      await this.ensureVersion(existing.id, existing.versions[0]);
    }
    this.seeded = true;
  }

  /** True only for a stored body that is byte-identical to a version this code seeded: no admin has touched it. */
  private isUntouchedSeed(body: string): boolean {
    return body === RESPONDER_SYSTEM_BODY_V1_0_0 || body === RESPONDER_SYSTEM_BODY_V1_2_0 || createHash('md5').update(body).digest('hex') === RESPONDER_SYSTEM_BODY_V1_1_0_MD5;
  }

  /**
   * Brings an already-seeded template up to the latest RESPONDER_SYSTEM_VERSION. The new version only becomes ACTIVE when the
   * current ACTIVE one is untouched seed text (the original v1.0.0, v1.1.0 or v1.2.0), so a prompt customised by a tenant
   * admin or platform admin is never replaced: for those, the new version is created as a DRAFT and activation stays a deliberate
   * step. If an untouched install already holds the new version as an unedited DRAFT (created by an earlier deploy that could
   * not upgrade it), that draft is activated instead of creating a second copy. A template with no ACTIVE version at all is a
   * separate, pre-existing anomaly this method doesn't try to fix -- getActiveVersion's own NotFoundException surfaces it.
   */
  private async ensureVersion(templateId: string, active: { id: string; version: string; body: string } | undefined): Promise<void> {
    if (!active || active.version === RESPONDER_SYSTEM_VERSION) return;

    const untouched = this.isUntouchedSeed(active.body);
    const existing = await this.prisma.aiPromptVersion.findFirst({ where: { templateId, version: RESPONDER_SYSTEM_VERSION } });
    if (existing) {
      // Only an unedited draft of exactly the current body, on an untouched install, is activated; anything else stays as it is.
      if (untouched && existing.status === 'DRAFT' && existing.body === RESPONDER_SYSTEM_BODY) {
        await this.prisma.$transaction([
          this.prisma.aiPromptVersion.update({ where: { id: active.id }, data: { status: 'ARCHIVED' } }),
          this.prisma.aiPromptVersion.update({ where: { id: existing.id }, data: { status: 'ACTIVE', activatedAt: new Date() } }),
        ]);
        this.logger.log(`Activated the existing v${RESPONDER_SYSTEM_VERSION} draft of "${RESPONDER_SYSTEM_TEMPLATE_KEY}" (the ACTIVE v${active.version} was untouched seed text)`);
      }
      return;
    }

    const created = await this.prisma.aiPromptVersion.create({
      data: {
        templateId,
        version: RESPONDER_SYSTEM_VERSION,
        status: untouched ? 'ACTIVE' : 'DRAFT',
        body: RESPONDER_SYSTEM_BODY,
        variables: [...RESPONDER_SYSTEM_VARIABLES],
        activatedAt: untouched ? new Date() : undefined,
        changeNote: RESPONDER_SYSTEM_CHANGE_NOTE,
      },
    });

    if (untouched) {
      await this.prisma.aiPromptVersion.update({ where: { id: active.id }, data: { status: 'ARCHIVED' } });
      this.logger.log(`Auto-upgraded prompt template "${RESPONDER_SYSTEM_TEMPLATE_KEY}" to v${RESPONDER_SYSTEM_VERSION}`);
    } else {
      this.logger.log(`Prompt template "${RESPONDER_SYSTEM_TEMPLATE_KEY}" has a customized ACTIVE version -- v${RESPONDER_SYSTEM_VERSION} created as DRAFT (id ${created.id}), not auto-activated`);
    }
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

    // A stored prompt that still scripts a fixed customer reply is never served, whatever its status: the current seed body is
    // used in its place, in memory only. Nothing in the database is changed, so an admin's customisations stay on record.
    const retired = templateKey === RESPONDER_SYSTEM_TEMPLATE_KEY && containsRetiredScript(active.body);
    if (retired && !this.warnedRetired.has(active.id)) {
      this.warnedRetired.add(active.id);
      this.logger.warn(`ACTIVE prompt v${active.version} (${active.id}) of "${templateKey}" scripts a fixed customer reply; serving the current built-in v${RESPONDER_SYSTEM_VERSION} body instead until a clean version is activated`);
    }
    const entry: CachedVersion = {
      id: active.id,
      templateId: active.templateId,
      version: active.version,
      body: retired ? RESPONDER_SYSTEM_BODY : active.body,
      variables: retired ? [...RESPONDER_SYSTEM_VARIABLES] : active.variables,
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
