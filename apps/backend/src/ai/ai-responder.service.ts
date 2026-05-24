import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';

interface OffHoursDay { enabled?: boolean; start?: string; end?: string }

function isOffHours(schedule: Record<string, OffHoursDay>, timezone: string): boolean {
  const now = new Date();
  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone })
    .format(now)
    .toLowerCase(); // "mon", "tue", etc.

  const timeStr = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
  }).format(now);

  const [currentH, currentM] = timeStr.split(':').map(Number);
  const currentMinutes = currentH * 60 + currentM;

  const day = schedule[dayName];
  if (!day?.enabled) return true; // day not configured = off hours

  const [startH, startM] = (day.start ?? '09:00').split(':').map(Number);
  const [endH, endM] = (day.end ?? '17:00').split(':').map(Number);

  return currentMinutes < (startH * 60 + startM) || currentMinutes >= (endH * 60 + endM);
}

@Injectable()
export class AiResponderService {
  private readonly logger = new Logger(AiResponderService.name);

  constructor(
    private prisma: PrismaService,
    private knowledgeBaseService: KnowledgeBaseService,
  ) {}

  async findOrCreateVerzAgent(tenantId: string): Promise<{ id: string; name: string; avatarUrl: string | null }> {
    const existing = await this.prisma.user.findFirst({
      where: { tenantId, isAiAgent: true },
      select: { id: true, name: true, avatarUrl: true },
    });
    if (existing) return existing;

    return this.prisma.user.create({
      data: {
        tenantId,
        name: 'Verz',
        email: `verz-ai-${tenantId}@ai.system`,
        passwordHash: '',
        role: 'AGENT',
        isAiAgent: true,
        isActive: false,
      },
      select: { id: true, name: true, avatarUrl: true },
    });
  }

  async shouldRespond(tenantId: string): Promise<boolean> {
    const [settings, tenant] = await Promise.all([
      this.prisma.tenantSettings.findUnique({
        where: { tenantId },
        select: { aiEnabled: true, aiAlwaysOn: true, offHoursEnabled: true, offHoursSchedule: true, timezone: true, aiTrialApprovedAt: true },
      }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiCredits: true } }),
    ]);

    if (!settings?.aiEnabled) return false;

    // Require explicit admin approval after 30-day learning trial
    if (!settings.aiTrialApprovedAt) return false;

    // Require AI credits in the wallet
    if (!tenant || tenant.aiCredits <= 0) return false;

    if (settings.aiAlwaysOn) return true;
    if (!settings.offHoursEnabled) return false;

    const schedule = (settings.offHoursSchedule as Record<string, OffHoursDay>) ?? {};
    return isOffHours(schedule, settings.timezone ?? 'UTC');
  }

  async respond(tenantId: string, conversationId: string, customerMessage: string, contactName?: string): Promise<string | null> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return null;

    const [settings, articles, history] = await Promise.all([
      this.prisma.tenantSettings.findUnique({
        where: { tenantId },
        select: { businessName: true, aiPersonality: true },
      }),
      this.knowledgeBaseService.getActive(tenantId),
      this.prisma.message.findMany({
        where: { conversationId, type: 'TEXT', content: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { direction: true, content: true },
      }),
    ]);

    const businessName = settings?.businessName ?? 'our business';
    const personality = settings?.aiPersonality ?? 'You are helpful, friendly, and professional. Keep replies concise and conversational.';

    let kbContext = '';
    if (articles.length > 0) {
      kbContext = '\n\nKNOWLEDGE BASE:\n' + articles
        .map(a => `## ${a.title}\n${a.content}`)
        .join('\n\n');
    }

    const systemPrompt =
      `You are the AI assistant for ${businessName}, handling customer messages on WhatsApp outside of business hours.\n\n` +
      `PERSONALITY: ${personality}\n\n` +
      `RULES:\n` +
      `- Use ONLY the knowledge base below to answer questions. Do not make up information.\n` +
      `- If the question cannot be answered from the knowledge base, say something like: "That's a great question! Our team will follow up with you during business hours."\n` +
      `- Keep replies short (1-3 sentences). This is WhatsApp, not email.\n` +
      `- Address the customer by name if provided. Do not use markdown formatting.\n` +
      `- Never claim to be a human if asked directly.` +
      kbContext;

    // Build conversation history for multi-turn context (chronological order)
    const historyMessages = history.reverse().map((m) => ({
      role: m.direction === 'INBOUND' ? 'user' : 'assistant',
      content: m.content!,
    }));

    // First user message includes the contact name hint; subsequent turns use plain content
    const userContent = contactName
      ? `Customer name: ${contactName}\nMessage: ${customerMessage}`
      : customerMessage;

    // Merge history + current message, dedup the last message if it's already in history
    const lastHistoryMsg = historyMessages[historyMessages.length - 1];
    const chatMessages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages.slice(0, -1), // history without the last (current) message
      { role: 'user', content: lastHistoryMsg?.content === customerMessage ? userContent : userContent },
    ].filter((m, i, arr) => {
      // Avoid consecutive same-role duplicates from the merge
      if (i === 0) return true;
      return !(m.role === arr[i - 1].role && m.content === arr[i - 1].content);
    });

    try {
      const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',
        {
          model: 'deepseek-chat',
          max_tokens: 300,
          messages: chatMessages,
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const text = response.data?.choices?.[0]?.message?.content as string | undefined;
      return text?.trim() ?? null;
    } catch (err) {
      this.logger.error('AI responder error', err);
      return null;
    }
  }
}
