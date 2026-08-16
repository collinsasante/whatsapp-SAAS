import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { DEEPSEEK_API_URL, DEEPSEEK_MODEL } from '../common/deepseek';
import { articleContentKey, articleTitleKey, selectRelevantArticles } from './knowledge-base.util';

const LEARN_THROTTLE_MS = 30 * 60 * 1000;

// Hard caps for getRelevant()'s prompt-bound KB context -- see selectRelevantArticles()'s
// doc comment. ~6000 chars is roughly 1500 tokens (English averages ~4 chars/token),
// generous enough for a real answer without approaching "send the whole KB" territory.
const KB_RELEVANCE_MAX_ARTICLES = 5;
const KB_RELEVANCE_MAX_CHARS = 6000;

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Throttle is persisted on TenantSettings.lastKbLearnAt (not an in-memory Map) so
   * it survives backend restarts/deploys/crashes -- a Map resets to empty on every
   * process start, which let learning re-fire far more often than intended during
   * periods of frequent deploys.
   *
   * The claim itself is a single conditional UPDATE ("only proceed if no one else
   * already claimed this tenant's slot within the window"), which Postgres executes
   * atomically at the row level. That makes this safe across multiple backend
   * instances: two concurrent callers racing on the same tenant will not both see
   * count > 0 -- only whichever UPDATE commits first satisfies the WHERE clause.
   */
  async triggerLearningAsync(tenantId: string): Promise<void> {
    const cutoff = new Date(Date.now() - LEARN_THROTTLE_MS);
    const claimed = await this.prisma.tenantSettings.updateMany({
      where: { tenantId, OR: [{ lastKbLearnAt: null }, { lastKbLearnAt: { lt: cutoff } }] },
      data: { lastKbLearnAt: new Date() },
    });
    if (claimed.count === 0) return;
    void this.learnFromConversations(tenantId).catch((err) => this.logger.error('background learning error', err));
  }

  async list(tenantId: string) {
    return this.prisma.knowledgeBaseArticle.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(tenantId: string, data: { title: string; content: string; isActive?: boolean; source?: string; sourceRef?: string }) {
    return this.prisma.knowledgeBaseArticle.create({
      data: { tenantId, source: 'manual', ...data },
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

  /** Bounded, relevance-filtered subset of getActive() for use in LLM prompts -- see selectRelevantArticles() for the full rationale. */
  async getRelevant(tenantId: string, query: string): Promise<{ title: string; content: string }[]> {
    const all = await this.getActive(tenantId);
    return selectRelevantArticles(all, query, { maxArticles: KB_RELEVANCE_MAX_ARTICLES, maxChars: KB_RELEVANCE_MAX_CHARS });
  }

  async uploadFile(tenantId: string, file: Express.Multer.File): Promise<{ created: number }> {
    const mimeType = file.mimetype;
    const filename = file.originalname;
    let content = '';

    if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
        const data = await pdfParse(file.buffer);
        content = data.text.replace(/\s+/g, ' ').trim();
      } catch (err) {
        this.logger.error('PDF parse error', err);
        throw new BadRequestException('Could not parse PDF file');
      }
    } else if (
      mimeType === 'text/plain' ||
      mimeType === 'text/csv' ||
      filename.endsWith('.txt') ||
      filename.endsWith('.csv') ||
      filename.endsWith('.md')
    ) {
      content = file.buffer.toString('utf-8').replace(/\s+/g, ' ').trim();
    } else {
      throw new BadRequestException('Unsupported file type. Upload PDF, TXT, CSV, or MD files.');
    }

    if (!content || content.length < 20) {
      throw new BadRequestException('File appears to be empty or could not be read');
    }

    // Chunk large content into multiple articles (max 3000 chars each)
    const chunks = this.chunkText(content, 3000);
    const title = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');

    for (let i = 0; i < chunks.length; i++) {
      const chunkTitle = chunks.length > 1 ? `${title} (Part ${i + 1})` : title;
      await this.prisma.knowledgeBaseArticle.create({
        data: {
          tenantId,
          title: chunkTitle,
          content: chunks[i],
          source: 'upload',
          sourceRef: filename,
          isActive: true,
        },
      });
    }

    return { created: chunks.length };
  }

  async scrapeUrl(tenantId: string, url: string): Promise<{ created: number }> {
    let htmlContent = '';
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VerzChat/1.0; +https://verzchat.com)' },
        maxContentLength: 500_000,
      });
      htmlContent = response.data as string;
    } catch (err) {
      this.logger.error('URL scrape error', err);
      throw new BadRequestException('Could not fetch URL. Make sure it is publicly accessible.');
    }

    // Strip HTML tags and extract readable text
    const text = htmlContent
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text || text.length < 50) {
      throw new BadRequestException('Could not extract readable content from this URL');
    }

    // Extract page title from HTML
    const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

    const chunks = this.chunkText(text, 3000);
    for (let i = 0; i < chunks.length; i++) {
      const chunkTitle = chunks.length > 1 ? `${pageTitle} (Part ${i + 1})` : pageTitle;
      await this.prisma.knowledgeBaseArticle.create({
        data: {
          tenantId,
          title: chunkTitle,
          content: chunks[i],
          source: 'url',
          sourceRef: url,
          isActive: true,
        },
      });
    }

    return { created: chunks.length };
  }

  private chunkText(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      let end = start + maxLen;
      if (end < text.length) {
        const lastSpace = text.lastIndexOf(' ', end);
        if (lastSpace > start) end = lastSpace;
      }
      chunks.push(text.slice(start, end).trim());
      start = end + 1;
    }
    return chunks.filter(Boolean);
  }

  async deduplicateArticles(tenantId: string): Promise<{ deleted: number }> {
    const articles = await this.prisma.knowledgeBaseArticle.findMany({
      where: { tenantId, source: 'learned' },
      orderBy: { createdAt: 'desc' }, // most recent first — first seen wins
      select: { id: true, title: true, content: true },
    });

    const seenTitles = new Set<string>();
    const seenContent = new Set<string>();
    const toDelete: string[] = [];

    for (const a of articles) {
      const titleKey = articleTitleKey(a.title);
      const contentKey = articleContentKey(a.content);
      if (seenTitles.has(titleKey) || seenContent.has(contentKey)) {
        toDelete.push(a.id);
      } else {
        seenTitles.add(titleKey);
        seenContent.add(contentKey);
      }
    }

    if (toDelete.length > 0) {
      await this.prisma.knowledgeBaseArticle.deleteMany({
        where: { tenantId, id: { in: toDelete } },
      });
    }

    return { deleted: toDelete.length };
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
        DEEPSEEK_API_URL,
        {
          model: DEEPSEEK_MODEL,
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
        { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } },
      );

      const raw = (response.data?.choices?.[0]?.message?.content as string ?? '').trim();
      const jsonStart = raw.indexOf('[');
      const jsonEnd = raw.lastIndexOf(']');
      if (jsonStart === -1 || jsonEnd === -1) return { created: 0 };

      const articles = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Array<{ title?: string; content?: string }>;

      // Same normalized title/content-prefix comparison deduplicateArticles() uses
      // for manual cleanup, applied here as a pre-insert check instead -- this runs
      // every ~30 min indefinitely, so without a real "does this already exist"
      // check (not just an exact-string title match) it slowly fills the KB with
      // near-duplicates that differ only in title phrasing or wording, which then
      // all get sent as prompt context on every customer reply.
      const existingArticles = await this.prisma.knowledgeBaseArticle.findMany({
        where: { tenantId },
        select: { title: true, content: true },
      });
      const seenTitles = new Set(existingArticles.map((a) => articleTitleKey(a.title)));
      const seenContent = new Set(existingArticles.map((a) => articleContentKey(a.content)));

      let created = 0;
      for (const art of articles) {
        if (!art.title || !art.content) continue;
        const titleKey = articleTitleKey(art.title);
        const contentKey = articleContentKey(art.content);
        if (seenTitles.has(titleKey) || seenContent.has(contentKey)) continue;

        await this.prisma.knowledgeBaseArticle.create({
          data: { tenantId, title: art.title, content: art.content, source: 'learned', isActive: true },
        });
        // Claim these keys immediately so a second near-duplicate proposed in the
        // same batch (the LLM sometimes returns two similar articles at once) is
        // also skipped, not just duplicates against pre-existing articles.
        seenTitles.add(titleKey);
        seenContent.add(contentKey);
        created++;
      }
      return { created };
    } catch (err) {
      this.logger.error('learnFromConversations error', err);
      return { created: 0 };
    }
  }
}
