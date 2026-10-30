import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { AGENT_ROLES } from './digital-self.service';
import { DIGITAL_SELF_FLAG_KEY } from './digital-self-learning.trigger';
import { formatStyleBlock, parseProfile, summarizeProfile } from './profile.util';

const WITH_AGENT = (tenantId: string) =>
  ({ user: { select: { isActive: true, isAiAgent: true, role: true, workspaceMemberships: { where: { workspaceId: tenantId }, select: { status: true } } } } }) satisfies Prisma.DigitalSelfInclude;

type LoadedSelf = Prisma.DigitalSelfGetPayload<{ include: ReturnType<typeof WITH_AGENT> }>;

/**
 * The one place every AI response path (commerce, v2 pipeline, legacy responder) asks "how should this reply sound?". Returns a
 * compact prompt block, or '' for ANY reason it cannot or should not apply -- flag off, no Digital Self, deactivated, agent no
 * longer active, too little learned, or a failed lookup -- so the AI falls back to its existing behaviour and a customer's reply
 * is never blocked or delayed by personality data. Two indexed reads on the reply path; nothing is analysed here.
 */
@Injectable()
export class DigitalSelfContextService {
  private readonly logger = new Logger(DigitalSelfContextService.name);

  constructor(
    private prisma: PrismaService,
    private featureFlags: FeatureFlagsService,
  ) {}

  async getStyleBlock(tenantId: string, conversationId: string | null | undefined): Promise<string> {
    if (!tenantId || !conversationId) return '';
    try {
      if (!(await this.featureFlags.isEnabledCached(DIGITAL_SELF_FLAG_KEY, tenantId))) return '';
      const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId }, select: { digitalSelfId: true, assignedToId: true } });
      if (!conv) return '';
      // Explicit assignment first; otherwise the human owner's own Digital Self. An AI-owned or unowned conversation gets none.
      const self = conv.digitalSelfId
        ? await this.prisma.digitalSelf.findFirst({ where: { id: conv.digitalSelfId, tenantId }, include: WITH_AGENT(tenantId) })
        : conv.assignedToId
          ? await this.prisma.digitalSelf.findFirst({ where: { tenantId, userId: conv.assignedToId }, include: WITH_AGENT(tenantId) })
          : null;
      return this.blockFor(self);
    } catch (err) {
      this.logger.warn(`Digital Self lookup failed; replying without a style: ${err instanceof Error ? err.name : 'unknown error'}`);
      return '';
    }
  }

  /** For the preview: the block for a specific Digital Self, under the same eligibility rules as a live reply. */
  async getStyleBlockFor(tenantId: string, digitalSelfId: string): Promise<string> {
    const self = await this.prisma.digitalSelf.findFirst({ where: { id: digitalSelfId, tenantId }, include: WITH_AGENT(tenantId) });
    return this.blockFor(self);
  }

  private blockFor(self: LoadedSelf | null): string {
    if (!self || !self.enabled) return '';
    const u = self.user;
    const memberOk = u.workspaceMemberships.every((m) => m.status === 'ACTIVE');
    if (!u.isActive || u.isAiAgent || !(AGENT_ROLES as string[]).includes(u.role) || !memberOk) return '';
    return formatStyleBlock(summarizeProfile(parseProfile(self.profile)));
  }
}
