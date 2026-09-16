import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiResponderService } from '../../ai/ai-responder.service';
import { DEFAULT_MODEL_KEY } from '../models/model-catalog';

const DEFAULT_AGENT_NAME = 'Verz';

export interface CreateAiAgentDto {
  name: string;
  description?: string;
  personality?: string;
  tone?: string;
  language?: string;
  modelKey?: string;
  maxResponseTokens?: number;
  systemInstructions?: string;
  assignedNumberIds?: string[];
}

export type UpdateAiAgentDto = Partial<CreateAiAgentDto> & { status?: 'ACTIVE' | 'PAUSED' };

@Injectable()
export class AiAgentsService {
  constructor(
    private prisma: PrismaService,
    private aiResponder: AiResponderService,
  ) {}

  list(tenantId: string) {
    return this.prisma.aiAgent.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  }

  async findOne(tenantId: string, id: string) {
    const agent = await this.prisma.aiAgent.findFirst({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('AI agent not found');
    return agent;
  }

  async create(tenantId: string, dto: CreateAiAgentDto) {
    const existing = await this.prisma.aiAgent.findUnique({ where: { tenantId_name: { tenantId, name: dto.name } } });
    if (existing) throw new ConflictException(`An AI agent named "${dto.name}" already exists`);

    if (dto.assignedNumberIds?.length) await this.validateAssignedNumbers(tenantId, dto.assignedNumberIds);

    return this.prisma.aiAgent.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        personality: dto.personality,
        tone: dto.tone,
        language: dto.language ?? 'en',
        modelKey: dto.modelKey ?? DEFAULT_MODEL_KEY,
        maxResponseTokens: dto.maxResponseTokens ?? 400,
        systemInstructions: dto.systemInstructions,
        assignedNumberIds: dto.assignedNumberIds ?? [],
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateAiAgentDto) {
    await this.findOne(tenantId, id); // tenant-scoped existence check before the write
    if (dto.assignedNumberIds?.length) await this.validateAssignedNumbers(tenantId, dto.assignedNumberIds);
    return this.prisma.aiAgent.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.personality !== undefined && { personality: dto.personality }),
        ...(dto.tone !== undefined && { tone: dto.tone }),
        ...(dto.language !== undefined && { language: dto.language }),
        ...(dto.modelKey !== undefined && { modelKey: dto.modelKey }),
        ...(dto.maxResponseTokens !== undefined && { maxResponseTokens: dto.maxResponseTokens }),
        ...(dto.systemInstructions !== undefined && { systemInstructions: dto.systemInstructions }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.assignedNumberIds !== undefined && { assignedNumberIds: dto.assignedNumberIds }),
      },
    });
  }

  /** Confirms every assigned WhatsApp number id actually belongs to this tenant before an agent can claim it. */
  private async validateAssignedNumbers(tenantId: string, numberIds: string[]) {
    const found = await this.prisma.whatsAppNumber.findMany({
      where: { id: { in: numberIds }, tenantId },
      select: { id: true },
    });
    if (found.length !== new Set(numberIds).size) {
      throw new BadRequestException('One or more assigned WhatsApp numbers were not found for this workspace');
    }
  }

  /**
   * Lazily backfills the tenant's default AiAgent, no data migration required.
   * Reuses the SAME synthetic isAiAgent User row the legacy responder already
   * uses (via AiResponderService.findOrCreateVerzAgent) -- both the legacy and
   * v2 pipelines must share one inbox identity, or self-assignment/analytics
   * fragment across two "Verz" users depending on which pipeline answered.
   */
  async findOrCreateDefaultAgent(tenantId: string) {
    const existing = await this.prisma.aiAgent.findFirst({ where: { tenantId, isDefault: true } });
    if (existing) return existing;

    const [agentUser, settings] = await Promise.all([
      this.aiResponder.findOrCreateVerzAgent(tenantId),
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { aiPersonality: true } }),
    ]);

    return this.prisma.aiAgent.create({
      data: {
        tenantId,
        name: DEFAULT_AGENT_NAME,
        isDefault: true,
        agentUserId: agentUser.id,
        personality: settings?.aiPersonality ?? null,
        modelKey: DEFAULT_MODEL_KEY,
      },
    });
  }

  /**
   * Picks the agent that should answer for a specific WhatsApp number, so a
   * tenant with e.g. a Sales and a Support number can run two differently-
   * configured agents. Falls back to the tenant's default agent whenever no
   * number is known (legacy callers, non-WhatsApp channels) or no agent has
   * explicitly claimed this number yet -- unchanged behavior for every tenant
   * with a single number/single agent, which is every tenant today.
   */
  async resolveAgentForNumber(tenantId: string, whatsappNumberId?: string | null) {
    if (whatsappNumberId) {
      const assigned = await this.prisma.aiAgent.findFirst({
        where: { tenantId, status: 'ACTIVE', assignedNumberIds: { has: whatsappNumberId } },
        orderBy: { createdAt: 'asc' },
      });
      if (assigned) return assigned;
    }
    return this.findOrCreateDefaultAgent(tenantId);
  }
}
