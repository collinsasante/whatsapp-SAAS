import { Injectable, Logger } from '@nestjs/common';
import { Lead, LeadStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../commerce/orders/orders.service';
import { AiCompletionService } from '../ai-core/completion/ai-completion.service';
import { ChatMessage } from '../ai-core/providers/ai-provider.interface';

// CONVERTED deliberately excluded: that transition happens exactly once, from
// markConverted() below on a real verified payment (mirroring Order.status = PAID's
// single-writer rule) -- never from the model's own free-text claim about this JSON field.
const VALID_STATUSES = new Set<LeadStatus>([
  'NEW', 'ENGAGED', 'QUALIFIED', 'HOT', 'WARM', 'NURTURE', 'UNQUALIFIED', 'LOST',
]);

const THROTTLE_MS = 5 * 60 * 1000;

interface ParsedQualification {
  score: number;
  status: LeadStatus;
  intent: string | null;
  urgencySignal: string | null;
  budgetSignal: string | null;
  productInterest: string | null;
  recommendedNextAction: string | null;
  reasoningSummary: string | null;
}

/**
 * Scores how promising a conversation is as a sales lead -- one evolving row per
 * conversation, upserted in place. Called two ways (Verz-AI unification, Phase B):
 * a fire-and-forget background pass after each inbound commerce message
 * (throttled, see THROTTLE_MS), and the `qualify_lead` tool
 * (ai-core/tools/lead.tools.ts) when the agent itself wants a fresh read
 * mid-conversation (always bypasses the throttle -- an explicit ask deserves a
 * fresh answer, not a stale cached one). Both paths funnel through this same
 * scoring logic so there is exactly one lead-intelligence implementation.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private prisma: PrismaService,
    private orders: OrdersService,
    private aiCompletion: AiCompletionService,
  ) {}

  async getForConversation(tenantId: string, conversationId: string): Promise<Lead | null> {
    return this.prisma.lead.findFirst({ where: { tenantId, conversationId } });
  }

  async markConverted(tenantId: string, conversationId: string): Promise<void> {
    await this.prisma.lead.updateMany({ where: { tenantId, conversationId }, data: { status: 'CONVERTED' } });
  }

  /** Staff-triggered rescore that works even on a conversation with no Lead row yet --
   * looks up the conversation's contactId itself rather than requiring a prior score. */
  async rescore(tenantId: string, conversationId: string): Promise<Lead | null> {
    const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId }, select: { contactId: true } });
    if (!conversation) return null;
    return this.scoreConversation(tenantId, conversationId, conversation.contactId, { force: true });
  }

  async scoreConversation(
    tenantId: string,
    conversationId: string,
    contactId: string,
    opts: { force?: boolean } = {},
  ): Promise<Lead | null> {
    const existing = await this.prisma.lead.findUnique({ where: { conversationId } });
    if (!opts.force && existing?.lastScoredAt && Date.now() - existing.lastScoredAt.getTime() < THROTTLE_MS) {
      return existing;
    }

    const [history, orders, settings] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId, type: 'TEXT', content: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { direction: true, content: true },
      }),
      this.orders.findAll(tenantId, undefined, contactId).catch(() => []),
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { businessName: true } }),
    ]);

    if (history.length === 0) return existing;

    const conversationText = history.reverse().map((m) => `${m.direction === 'INBOUND' ? 'Customer' : 'Agent'}: ${m.content}`).join('\n');
    const orderSummary = orders.length === 0
      ? 'No past orders.'
      : orders.slice(0, 5).map((o) => `- ${o.status}, ${o.totalMajorUnits} ${o.currency}, ${o.items.length} item(s), placed ${o.createdAt.toISOString().slice(0, 10)}`).join('\n');

    const systemPrompt = [
      `You are a sales-lead analyst for ${settings?.businessName ?? 'this business'}. Read the WhatsApp conversation and past order history below and assess how promising this lead is.`,
      ``,
      `Respond with ONLY this JSON, no other text:`,
      `{`,
      `  "score": <integer 0-100, higher = more likely to buy soon>,`,
      `  "status": "<one of NEW, ENGAGED, QUALIFIED, HOT, WARM, NURTURE, UNQUALIFIED, LOST>",`,
      `  "intent": "<one short sentence on what they want, or null>",`,
      `  "urgencySignal": "<short phrase, or null>",`,
      `  "budgetSignal": "<short phrase, or null>",`,
      `  "productInterest": "<short phrase, or null>",`,
      `  "recommendedNextAction": "<one short actionable sentence for staff, or null>",`,
      `  "reasoningSummary": "<1-2 sentences justifying the score, for staff eyes only -- never shown to the customer>"`,
      `}`,
    ].join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `CONVERSATION:\n${conversationText}\n\nPAST ORDERS:\n${orderSummary}` },
    ];

    const result = await this.aiCompletion.complete({
      tenantId, taskType: 'LEAD_SCORE', conversationId, messages, jsonMode: true, maxTokens: 400,
    });
    if (result.failed || !result.content) return existing;

    const parsed = this.parse(result.content);
    if (!parsed) {
      this.logger.warn(`LeadsService: unparseable qualification response for conversation ${conversationId}`);
      return existing;
    }

    return this.prisma.lead.upsert({
      where: { conversationId },
      create: { tenantId, contactId, conversationId, ...parsed, lastScoredAt: new Date() },
      update: { ...parsed, lastScoredAt: new Date() },
    });
  }

  private parse(raw: string): ParsedQualification | null {
    try {
      const obj = JSON.parse(raw.trim()) as Record<string, unknown>;
      const score = typeof obj.score === 'number' ? Math.min(100, Math.max(0, Math.round(obj.score))) : 0;
      const statusRaw = typeof obj.status === 'string' ? (obj.status.toUpperCase() as LeadStatus) : null;
      const status = statusRaw && VALID_STATUSES.has(statusRaw) ? statusRaw : 'NEW';
      const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null);
      return {
        score,
        status,
        intent: str(obj.intent),
        urgencySignal: str(obj.urgencySignal),
        budgetSignal: str(obj.budgetSignal),
        productInterest: str(obj.productInterest),
        recommendedNextAction: str(obj.recommendedNextAction),
        reasoningSummary: str(obj.reasoningSummary),
      };
    } catch {
      return null;
    }
  }
}
