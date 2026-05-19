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

  async shouldRespond(tenantId: string): Promise<boolean> {
    const settings = await this.prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { aiEnabled: true, aiAlwaysOn: true, offHoursEnabled: true, offHoursSchedule: true, timezone: true },
    });
    if (!settings?.aiEnabled) return false;
    if (settings.aiAlwaysOn) return true;
    if (!settings.offHoursEnabled) return false;

    const schedule = (settings.offHoursSchedule as Record<string, OffHoursDay>) ?? {};
    return isOffHours(schedule, settings.timezone ?? 'UTC');
  }

  async respond(tenantId: string, customerMessage: string, contactName?: string): Promise<string | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

    const [settings, articles] = await Promise.all([
      this.prisma.tenantSettings.findUnique({
        where: { tenantId },
        select: { businessName: true, aiPersonality: true },
      }),
      this.knowledgeBaseService.getActive(tenantId),
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

    const userContent = contactName
      ? `Customer name: ${contactName}\nMessage: ${customerMessage}`
      : customerMessage;

    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
        },
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
        },
      );

      const text = response.data?.content?.[0]?.text as string | undefined;
      return text?.trim() ?? null;
    } catch (err) {
      this.logger.error('AI responder error', err);
      return null;
    }
  }
}
