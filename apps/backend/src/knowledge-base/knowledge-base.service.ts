import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(private prisma: PrismaService) {}

  async list(tenantId: string) {
    return this.prisma.knowledgeBaseArticle.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(tenantId: string, data: { title: string; content: string; isActive?: boolean }) {
    return this.prisma.knowledgeBaseArticle.create({
      data: { tenantId, ...data },
    });
  }

  async update(tenantId: string, id: string, data: { title?: string; content?: string; isActive?: boolean }) {
    const article = await this.prisma.knowledgeBaseArticle.findFirst({ where: { id, tenantId } });
    if (!article) throw new NotFoundException('Article not found');
    return this.prisma.knowledgeBaseArticle.update({ where: { id }, data });
  }

  async remove(tenantId: string, id: string) {
    const article = await this.prisma.knowledgeBaseArticle.findFirst({ where: { id, tenantId } });
    if (!article) throw new NotFoundException('Article not found');
    await this.prisma.knowledgeBaseArticle.delete({ where: { id } });
  }

  async getActive(tenantId: string) {
    return this.prisma.knowledgeBaseArticle.findMany({
      where: { tenantId, isActive: true },
      select: { title: true, content: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async learnFromConversations(tenantId: string): Promise<{ created: number }> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return { created: 0 };

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const conversations = await this.prisma.conversation.findMany({
      where: { tenantId, updatedAt: { gte: since } },
      include: {
        messages: {
          where: { type: 'TEXT', content: { not: null }, deletedForEveryone: false },
          orderBy: { createdAt: 'asc' },
          include: { sender: { select: { isAiAgent: true } } },
        },
      },
      take: 60,
    });

    const pairs: { question: string; answer: string }[] = [];
    for (const conv of conversations) {
      const msgs = conv.messages;
      for (let i = 0; i < msgs.length - 1; i++) {
        const m = msgs[i];
        const next = msgs[i + 1];
        if (
          m.direction === 'INBOUND' &&
          next.direction === 'OUTBOUND' &&
          !(next as typeof next & { sender?: { isAiAgent?: boolean } }).sender?.isAiAgent &&
          m.content && next.content &&
          m.content.length > 5 && next.content.length > 10
        ) {
          pairs.push({ question: m.content.slice(0, 300), answer: next.content.slice(0, 500) });
        }
      }
    }

    if (pairs.length === 0) return { created: 0 };

    const sample = pairs.slice(0, 40);
    const convoText = sample.map((p, i) => `Q${i + 1}: ${p.question}\nA${i + 1}: ${p.answer}`).join('\n\n');

    try {
      const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',
        {
          model: 'deepseek-chat',
          max_tokens: 2000,
          messages: [
            {
              role: 'system',
              content:
                'You are analyzing customer service conversations to build a knowledge base. ' +
                'From the Q&A pairs provided, identify distinct recurring topics and write clear, reusable knowledge base articles. ' +
                'Return ONLY a valid JSON array of objects with "title" (short, specific topic title) and "content" (a helpful, complete answer). ' +
                'Create between 3 and 8 articles. Do not include any text outside the JSON array.',
            },
            { role: 'user', content: `Extract knowledge base articles from these conversations:\n\n${convoText}` },
          ],
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const raw = (response.data?.choices?.[0]?.message?.content as string ?? '').trim();
      const jsonStart = raw.indexOf('[');
      const jsonEnd = raw.lastIndexOf(']');
      if (jsonStart === -1 || jsonEnd === -1) return { created: 0 };

      const articles = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Array<{ title?: string; content?: string }>;
      let created = 0;
      for (const art of articles) {
        if (art.title && art.content) {
          await this.prisma.knowledgeBaseArticle.create({
            data: { tenantId, title: art.title, content: art.content, isActive: true },
          });
          created++;
        }
      }
      return { created };
    } catch (err) {
      this.logger.error('learnFromConversations error', err);
      return { created: 0 };
    }
  }
}
