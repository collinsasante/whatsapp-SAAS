import { EmbeddingInputKind, EmbeddingProvider, EmbeddingUnavailableError } from '../embedding-provider';
import { WordPieceTokenizer } from './wordpiece-tokenizer';

/** The slice of onnxruntime-web this adapter uses. Declared here so the package is not needed to compile or to run the unit tests. */
export interface OrtTensorOutput {
  readonly dims: readonly number[];
  readonly data: ArrayLike<number>;
}
export interface OrtSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorOutput>>;
}
export interface OrtRuntime {
  Tensor: new (type: 'int64', data: BigInt64Array, dims: readonly number[]) => unknown;
}

export interface LoadedMiniLm {
  tokenizer: WordPieceTokenizer;
  session: OrtSession;
  ort: OrtRuntime;
}

export const MINILM_DIMENSIONS = 384;
/** Measured on the synthetic evaluation set: MiniLM cosine scores are lower than larger models', so the shared 0.35 default costs recall. */
export const MINILM_RECOMMENDED_MIN_SCORE = 0.25;

export interface MiniLmOptions {
  /** Model identity stored with every vector. Change it (and re-index) whenever the weights or quantisation change. */
  model: string;
  load(): Promise<LoadedMiniLm>;
  /**
   * Texts per inference call. Default 1, deliberately: with the int8 model the activation scales depend on the whole batch, so a text
   * embedded beside others differs by up to ~1% (cosine 0.99) from the same text alone. One text per call makes a vector depend only on
   * its own text (stored and query vectors stay comparable whatever was indexed together) and was also faster. Inference runs on the
   * event-loop thread, so small calls keep other requests responsive.
   */
  batchSize?: number;
  /** Calls waiting for the single inference lane; beyond this the call fails fast and retrieval falls back to keywords. */
  maxQueued?: number;
  /** After a failed load, wait this long before trying again instead of re-reading 23 MB on every query. */
  retryAfterMs?: number;
  now?(): number;
  warn?(message: string): void;
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * all-MiniLM-L6-v2 run in-process through ONNX Runtime Web (WebAssembly), so it works on the musl/Alpine backend image where the native
 * onnxruntime-node binary cannot load. No network, no extra service. The model loads once, on first use (or `warmUp`), and is kept.
 *
 * Every failure (missing model or runtime, wrong files, a bad output shape, NaNs, an overloaded queue) surfaces as an exception and
 * never as a made-up vector, so the retriever falls back to keyword retrieval.
 */
export class LocalMiniLmEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'local-minilm';
  readonly dimensions = MINILM_DIMENSIONS;
  readonly recommendedMinVectorScore = MINILM_RECOMMENDED_MIN_SCORE;
  readonly model: string;

  private loaded: Promise<LoadedMiniLm> | null = null;
  private failedAt: number | null = null;
  private lastFailure: Error | null = null;
  private lane: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private readonly batchSize: number;
  private readonly maxQueued: number;
  private readonly retryAfterMs: number;

  constructor(private readonly options: MiniLmOptions) {
    this.model = options.model;
    this.batchSize = Math.max(1, Math.min(options.batchSize ?? 1, 64));
    this.maxQueued = options.maxQueued ?? 32;
    this.retryAfterMs = options.retryAfterMs ?? 30_000;
  }

  async warmUp(): Promise<void> {
    await this.ready();
  }

  async embed(texts: string[], _kind: EmbeddingInputKind): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.some((t) => typeof t !== 'string')) throw new EmbeddingUnavailableError('embed() needs strings');
    if (this.waiting >= this.maxQueued) throw new EmbeddingUnavailableError('the local embedding model is busy');
    this.waiting++;
    const run = this.lane.then(() => this.embedAll(texts));
    this.lane = run.catch(() => undefined); // one failed call must not block the lane for the next
    try {
      return await run;
    } finally {
      this.waiting--;
    }
  }

  private async ready(): Promise<LoadedMiniLm> {
    const now = (this.options.now ?? Date.now)();
    if (this.failedAt !== null && now - this.failedAt < this.retryAfterMs) {
      throw new EmbeddingUnavailableError(`the local embedding model could not be loaded: ${this.lastFailure?.message ?? 'unknown error'}`);
    }
    if (!this.loaded) {
      this.loaded = this.options.load().then(
        (value) => { this.failedAt = null; this.lastFailure = null; return value; },
        (err: unknown) => {
          this.loaded = null;
          this.failedAt = (this.options.now ?? Date.now)();
          this.lastFailure = err instanceof Error ? err : new Error(String(err));
          this.options.warn?.(`Local embedding model unavailable (${this.lastFailure.message}); retrieval stays on keywords. Retrying in ${Math.round(this.retryAfterMs / 1000)}s.`);
          throw new EmbeddingUnavailableError(`the local embedding model could not be loaded: ${this.lastFailure.message}`);
        },
      );
    }
    return this.loaded;
  }

  private async embedAll(texts: string[]): Promise<number[][]> {
    const loaded = await this.ready();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      if (i > 0) await yieldToEventLoop();
      out.push(...(await this.embedBatch(loaded, texts.slice(i, i + this.batchSize))));
    }
    return out;
  }

  private async embedBatch({ tokenizer, session, ort }: LoadedMiniLm, batch: string[]): Promise<number[][]> {
    const encoded = batch.map((t) => tokenizer.encode(t).ids);
    const width = Math.max(...encoded.map((ids) => ids.length));
    const dims = [batch.length, width] as const;
    const ids = new BigInt64Array(batch.length * width);
    const mask = new BigInt64Array(batch.length * width); // padding stays 0 for both
    encoded.forEach((row, b) => row.forEach((id, t) => { ids[b * width + t] = BigInt(id); mask[b * width + t] = 1n; }));

    const feeds: Record<string, unknown> = { input_ids: new ort.Tensor('int64', ids, dims), attention_mask: new ort.Tensor('int64', mask, dims) };
    if (session.inputNames.includes('token_type_ids')) feeds['token_type_ids'] = new ort.Tensor('int64', new BigInt64Array(ids.length), dims);

    let hidden: OrtTensorOutput | undefined;
    try {
      hidden = (await session.run(feeds))[session.outputNames[0]];
    } catch (err) {
      throw new EmbeddingUnavailableError(`the local embedding model failed to run: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!hidden || hidden.dims.length !== 3 || hidden.dims[0] !== batch.length || hidden.dims[1] !== width || hidden.dims[2] !== MINILM_DIMENSIONS || hidden.data.length !== batch.length * width * MINILM_DIMENSIONS) {
      throw new EmbeddingUnavailableError(`the local embedding model returned an unexpected output shape (${hidden ? hidden.dims.join('x') : 'none'})`);
    }
    return encoded.map((row, b) => meanPoolAndNormalize(hidden!.data, b, width, row.length));
  }
}

/** Mean of the token vectors that are not padding, then scaled to unit length (so cosine similarity is a dot product). */
export function meanPoolAndNormalize(data: ArrayLike<number>, batchIndex: number, width: number, realTokens: number): number[] {
  const sum = new Float64Array(MINILM_DIMENSIONS);
  for (let t = 0; t < realTokens; t++) {
    const base = (batchIndex * width + t) * MINILM_DIMENSIONS;
    for (let d = 0; d < MINILM_DIMENSIONS; d++) sum[d] += data[base + d];
  }
  let norm = 0;
  for (let d = 0; d < MINILM_DIMENSIONS; d++) { sum[d] /= realTokens; norm += sum[d] * sum[d]; }
  norm = Math.sqrt(norm);
  if (!Number.isFinite(norm) || norm === 0) throw new EmbeddingUnavailableError('the local embedding model produced an unusable vector');
  return Array.from(sum, (x) => x / norm);
}
