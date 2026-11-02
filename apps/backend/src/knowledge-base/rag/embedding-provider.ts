/**
 * The seam between retrieval and whatever produces embeddings. Nothing in this repository calls a hosted embedding API. The only
 * adapter is the in-process MiniLM model (see `embedding-adapters.ts`); with `EMBEDDING_PROVIDER` unset `createEmbeddingProvider`
 * returns null and retrieval stays keyword-only. Adding a provider is one class that implements this interface plus one entry in the
 * adapters map; no retrieval code changes.
 */
export type EmbeddingInputKind = 'document' | 'query';

export interface EmbeddingProvider {
  /** Short stable id, e.g. the vendor name. */
  readonly id: string;
  /** Model name. Stored with every vector, so vectors from different models are never compared. */
  readonly model: string;
  readonly dimensions: number;
  /** Similarity scores are not comparable across models; a provider can name the cut-off measured for it (RAG_MIN_VECTOR_SCORE still wins). */
  readonly recommendedMinVectorScore?: number;
  /** Optional: load the model ahead of the first query. Never required for correctness. */
  warmUp?(): Promise<void>;
  /** One vector per input text, in order. Throws on failure; callers fall back to keyword retrieval. */
  embed(texts: string[], kind: EmbeddingInputKind): Promise<number[][]>;
}

export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

export class EmbeddingUnavailableError extends Error {
  constructor(message = 'No embedding provider is configured') {
    super(message);
    this.name = 'EmbeddingUnavailableError';
  }
}

export type EmbeddingProviderFactory = (env: Record<string, string | undefined>) => EmbeddingProvider;

/**
 * `EMBEDDING_PROVIDER` unset or empty: no provider (keyword-only). A name that no adapter implements is an error worth surfacing
 * loudly at start-up rather than silently ignoring.
 */
export function createEmbeddingProvider(
  env: Record<string, string | undefined>,
  adapters: Record<string, EmbeddingProviderFactory> = {},
): EmbeddingProvider | null {
  const name = (env['EMBEDDING_PROVIDER'] ?? '').trim().toLowerCase();
  if (!name || name === 'none') return null;
  const factory = adapters[name];
  if (!factory) throw new EmbeddingUnavailableError(`EMBEDDING_PROVIDER="${name}" has no adapter in this build`);
  return factory(env);
}

export function normalizeVector(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  return norm === 0 ? v.slice() : v.map((x) => x / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
