import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { QueueName, KbEmbeddingJob } from '@whatsapp-platform/shared-types';

// Chunking + embedding logic duplicated from apps/backend/src/ai/chunking.util.ts
// and embeddings/embedding.service.ts -- the worker package has no compile-time
// dependency on the backend app (same precedent as analytics-rollup.processor.ts's
// duplicated classifyMrrMovement/normalizeToGhs). Keep these two copies in sync by
// hand; a divergence here would silently change what gets indexed vs what the
// backend expects to compare against at query time.

const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 400;
const OVERLAP_TOKENS = 60;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

interface Chunk { heading: string | null; content: string }
interface Section { heading: string | null; body: string }

function splitIntoSections(text: string): Section[] {
  const headingPattern = /^(#{1,6}\s+.+|[A-Z][A-Za-z0-9 /&'-]{2,60}:)$/gm;
  const matches = [...text.matchAll(headingPattern)];

  if (matches.length === 0) {
    return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((body) => ({ heading: null, body }));
  }

  const sections: Section[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const heading = matches[i][0].replace(/^#{1,6}\s+/, '').replace(/:$/, '').trim();
    const body = text.slice(start, end).trim();
    if (body) sections.push({ heading, body });
  }
  const preamble = text.slice(0, matches[0].index!).trim();
  if (preamble) sections.unshift({ heading: null, body: preamble });
  return sections;
}

function splitLongSection(body: string): string[] {
  if (body.length <= TARGET_CHARS) return [body];
  const parts: string[] = [];
  let start = 0;
  while (start < body.length) {
    let end = Math.min(start + TARGET_CHARS, body.length);
    if (end < body.length) {
      const lastSpace = body.lastIndexOf(' ', end);
      if (lastSpace > start) end = lastSpace;
    }
    parts.push(body.slice(start, end).trim());
    if (end >= body.length) break;
    start = Math.max(end - OVERLAP_CHARS, start + 1);
  }
  return parts.filter(Boolean);
}

function chunkArticle(title: string, content: string): Chunk[] {
  const sections = splitIntoSections(content);
  const chunks: Chunk[] = [];
  for (const section of sections) {
    for (const part of splitLongSection(section.body)) {
      const chunkContent = section.heading ? `${title} — ${section.heading}\n${part}` : `${title}\n${part}`;
      chunks.push({ heading: section.heading, content: chunkContent });
    }
  }
  return chunks.length > 0 ? chunks : [{ heading: null, content: `${title}\n${content}`.trim() }];
}

const HASH_DIMENSIONS = 256;
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as',
  'and', 'or', 'but', 'if', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'we', 'they', 'do', 'does', 'did', 'can', 'will',
]);

function tokenize(text: string): string[] {
  const words = text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).filter((w) => w.length > 1 && !STOPWORDS.has(w));
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) bigrams.push(`${words[i]}_${words[i + 1]}`);
  return [...words, ...bigrams];
}

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function embedLocalHash(text: string): number[] {
  const vector = new Array<number>(HASH_DIMENSIONS).fill(0);
  for (const token of tokenize(text)) {
    const idx = fnv1a(token) % HASH_DIMENSIONS;
    const sign = fnv1a(`${token}#sign`) % 2 === 0 ? 1 : -1;
    vector[idx] += sign;
  }
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vector : vector.map((v) => v / norm);
}

async function embedOpenAi(texts: string[], apiKey: string): Promise<number[][]> {
  const axios = (await import('axios')).default;
  const res = await axios.post(
    'https://api.openai.com/v1/embeddings',
    { model: 'text-embedding-3-small', input: texts },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 20_000 },
  );
  const data = res.data?.data as { embedding: number[]; index: number }[] | undefined;
  if (!data) throw new Error('OpenAI embeddings: malformed response');
  return [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export class KbEmbeddingWorker {
  private worker?: Worker;

  constructor(
    private prisma: PrismaClient,
    private connection: { host: string; port: number; password?: string },
  ) {}

  start() {
    this.worker = new Worker<KbEmbeddingJob>(
      QueueName.KB_EMBEDDING,
      this.process.bind(this),
      { connection: this.connection, concurrency: 3 },
    );
    this.worker.on('failed', (job, err) => {
      console.error(`KB embedding job ${job?.id} failed:`, err.message);
    });
    console.log('KB embedding worker started');
  }

  async stop() {
    await this.worker?.close();
  }

  private async process(job: Job<KbEmbeddingJob>) {
    const { tenantId, articleId } = job.data;

    const article = await this.prisma.knowledgeBaseArticle.findFirst({ where: { id: articleId, tenantId } });
    // Article may have been deleted since the job was queued -- FK cascade
    // already removed its chunks in that case, nothing to do.
    if (!article) return;

    const chunks = chunkArticle(article.title, article.content);
    const apiKey = process.env['OPENAI_API_KEY'];
    const embeddingModel = apiKey ? 'text-embedding-3-small' : 'local-hash-v1';
    const texts = chunks.map((c) => c.content);
    const vectors = apiKey ? await embedOpenAi(texts, apiKey) : texts.map(embedLocalHash);

    // Re-chunking from scratch on every update is simpler and correct at this
    // scale (delete-then-recreate) rather than diffing old vs new chunks.
    await this.prisma.$transaction([
      this.prisma.knowledgeBaseChunk.deleteMany({ where: { tenantId, articleId } }),
      this.prisma.knowledgeBaseChunk.createMany({
        data: chunks.map((c, i) => ({
          id: randomUUID(),
          tenantId,
          articleId,
          chunkIndex: i,
          heading: c.heading,
          content: c.content,
          embedding: vectors[i],
          embeddingModel,
        })),
      }),
    ]);
  }
}
