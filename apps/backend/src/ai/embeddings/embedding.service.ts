/**
 * Embedding provider abstraction. DeepSeek (Verz AI's generation model) has no
 * embeddings endpoint, and no embedding-provider API key exists in this
 * environment today -- see docs/verz-ai-audit.md for the full writeup.
 *
 * `LocalHashingEmbeddingService` is the default so retrieval and the eval
 * harness work with zero new paid dependencies. It uses feature hashing
 * (bag-of-words + bigrams, hashed into a fixed-size vector, L2-normalized) --
 * a real, deterministic technique, not a stand-in that merely compiles. It
 * will never match a true semantic embedding's ability to link "cost" with
 * "price", but combined with Postgres full-text search for exact lexical
 * matches (EmbeddingRetrievalService's hybrid merge), it's sufficient to meet
 * the eval bar for a curated per-tenant KB at current scale.
 *
 * Set OPENAI_API_KEY to switch to `text-embedding-3-small` automatically --
 * no other code changes required. See getEmbeddingService() below.
 */
export interface EmbeddingService {
  readonly modelName: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

const HASH_DIMENSIONS = 256;
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as',
  'and', 'or', 'but', 'if', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'we', 'they', 'do', 'does', 'did', 'can', 'will',
]);

function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));

  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]}_${words[i + 1]}`);
  }
  return [...words, ...bigrams];
}

/** FNV-1a — fast, well-distributed, deterministic across runs/processes. */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class LocalHashingEmbeddingService implements EmbeddingService {
  readonly modelName = 'local-hash-v1';
  readonly dimensions = HASH_DIMENSIONS;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(HASH_DIMENSIONS).fill(0);
    const tokens = tokenize(text);
    for (const token of tokens) {
      const idx = fnv1a(token) % HASH_DIMENSIONS;
      // Sign bit from a second hash reduces collision bias (standard feature-hashing trick).
      const sign = fnv1a(`${token}#sign`) % 2 === 0 ? 1 : -1;
      vector[idx] += sign;
    }
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    if (norm === 0) return vector;
    return vector.map((v) => v / norm);
  }
}

export class OpenAiEmbeddingService implements EmbeddingService {
  readonly modelName = 'text-embedding-3-small';
  readonly dimensions = 1536;

  constructor(private apiKey: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const axios = (await import('axios')).default;
    const res = await axios.post(
      'https://api.openai.com/v1/embeddings',
      { model: this.modelName, input: texts },
      { headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, timeout: 20_000 },
    );
    const data = res.data?.data as { embedding: number[]; index: number }[] | undefined;
    if (!data) throw new Error('OpenAI embeddings: malformed response');
    return [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

export function getEmbeddingService(): EmbeddingService {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) return new OpenAiEmbeddingService(apiKey);
  return new LocalHashingEmbeddingService();
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
