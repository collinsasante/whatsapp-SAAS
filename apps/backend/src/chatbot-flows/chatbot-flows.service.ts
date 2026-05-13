import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FlowTriggerType, Prisma } from '@prisma/client';

export interface FlowNode {
  id: string;
  type: 'text' | 'buttons' | 'image' | 'delay' | 'condition' | 'assign' | 'tag' | 'end';
  content?: string;
  mediaUrl?: string;
  buttons?: { id: string; text: string; nextNodeId?: string }[];
  delaySeconds?: number;
  conditionField?: string;
  conditionValue?: string;
  trueNodeId?: string;
  falseNodeId?: string;
  nextNodeId?: string;
  assignToId?: string;
  tag?: string;
}

export interface CreateFlowDto {
  name: string;
  description?: string;
  trigger: FlowTriggerType;
  keywords?: string[];
  nodes?: FlowNode[];
  priority?: number;
}

@Injectable()
export class ChatbotFlowsService {
  constructor(private prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.chatbotFlow.findMany({
      where: { tenantId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async get(id: string, tenantId: string) {
    const flow = await this.prisma.chatbotFlow.findFirst({ where: { id, tenantId } });
    if (!flow) throw new NotFoundException('Flow not found');
    return flow;
  }

  create(tenantId: string, dto: CreateFlowDto) {
    return this.prisma.chatbotFlow.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        trigger: dto.trigger,
        keywords: dto.keywords ?? [],
        nodes: (dto.nodes ?? []) as unknown as Prisma.InputJsonValue,
        priority: dto.priority ?? 0,
      },
    });
  }

  async update(id: string, tenantId: string, dto: Partial<CreateFlowDto> & { isActive?: boolean }) {
    const existing = await this.prisma.chatbotFlow.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Flow not found');
    return this.prisma.chatbotFlow.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.trigger !== undefined && { trigger: dto.trigger }),
        ...(dto.keywords !== undefined && { keywords: dto.keywords }),
        ...(dto.nodes !== undefined && { nodes: dto.nodes as unknown as Prisma.InputJsonValue }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(id: string, tenantId: string) {
    const existing = await this.prisma.chatbotFlow.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Flow not found');
    return this.prisma.chatbotFlow.delete({ where: { id } });
  }

  // Find matching flow for an incoming message
  async findMatchingFlow(tenantId: string, messageText: string) {
    const flows = await this.prisma.chatbotFlow.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ priority: 'desc' }],
    });
    const lower = messageText.toLowerCase().trim();

    for (const flow of flows) {
      if (flow.trigger === 'KEYWORD') {
        const match = flow.keywords.some((k) => lower === k.toLowerCase() || lower.includes(k.toLowerCase()));
        if (match) return flow;
      } else if (flow.trigger === 'FIRST_MESSAGE') {
        return flow;
      } else if (flow.trigger === 'FALLBACK') {
        return flow;
      }
    }
    return null;
  }
}
