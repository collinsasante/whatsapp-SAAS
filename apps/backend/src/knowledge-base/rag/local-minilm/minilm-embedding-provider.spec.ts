import { EmbeddingUnavailableError } from '../embedding-provider';
import { LoadedMiniLm, LocalMiniLmEmbeddingProvider, meanPoolAndNormalize, MINILM_DIMENSIONS, OrtSession } from './minilm-embedding-provider';
import { TokenizerFile, WordPieceTokenizer } from './wordpiece-tokenizer';

const TOKENS = ['[PAD]', '[UNK]', '[CLS]', '[SEP]', 'open', 'hours', 'park', 'car'];
const tokenizerFile: TokenizerFile = { normalizer: { lowercase: true }, model: { type: 'WordPiece', vocab: Object.fromEntries(TOKENS.map((t, i) => [t, i])), unk_token: '[UNK]' } };
const D = MINILM_DIMENSIONS;

class FakeTensor {
  constructor(readonly type: string, readonly data: BigInt64Array, readonly dims: readonly number[]) {}
}

/** Builds hidden states where token t of a row holds `value(rowIndex, t)` in dimension 0 and a distinct value in dimension 1. */
function fakeSession(opts: { inputNames?: string[]; value?: (row: number, t: number) => number; shape?: (b: number, w: number) => number[]; onRun?: (feeds: Record<string, FakeTensor>) => void; fail?: Error } = {}) {
  const runs: Array<Record<string, FakeTensor>> = [];
  const session: OrtSession = {
    inputNames: opts.inputNames ?? ['input_ids', 'attention_mask', 'token_type_ids'],
    outputNames: ['last_hidden_state'],
    async run(feeds) {
      const f = feeds as Record<string, FakeTensor>;
      runs.push(f);
      opts.onRun?.(f);
      if (opts.fail) throw opts.fail;
      const [b, w] = f['input_ids'].dims;
      const dims = opts.shape ? opts.shape(b, w) : [b, w, D];
      const data = new Float32Array(dims.reduce((a, c) => a * c, 1));
      for (let r = 0; r < b; r++) for (let t = 0; t < w; t++) { data[(r * w + t) * D] = (opts.value ?? (() => 1))(r, t); data[(r * w + t) * D + 1] = 1; }
      return { last_hidden_state: { dims, data } };
    },
  };
  return { session, runs };
}

const provider = (session: OrtSession, extra: Partial<ConstructorParameters<typeof LocalMiniLmEmbeddingProvider>[0]> = {}) =>
  new LocalMiniLmEmbeddingProvider({
    model: 'test-model',
    load: async (): Promise<LoadedMiniLm> => ({ tokenizer: new WordPieceTokenizer(tokenizerFile, 16), session, ort: { Tensor: FakeTensor as never } }),
    ...extra,
  });

const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

describe('meanPoolAndNormalize', () => {
  it('averages only the real tokens and returns a unit vector', () => {
    const data = new Float32Array(2 * 3 * D); // one row, width 3, of which 2 are real tokens; the third position is padding
    data[0] = 2; data[D] = 4; data[2 * D] = 1000; // padding value must not count
    const v = meanPoolAndNormalize(data, 0, 3, 2);
    expect(norm(v)).toBeCloseTo(1, 6);
    expect(v[0]).toBeCloseTo(1, 6); // mean (2+4)/2 = 3, normalised alone => 1
  });

  it('rejects a vector that is all zeros or not finite', () => {
    expect(() => meanPoolAndNormalize(new Float32Array(D), 0, 1, 1)).toThrow(EmbeddingUnavailableError);
    const nan = new Float32Array(D); nan[3] = NaN;
    expect(() => meanPoolAndNormalize(nan, 0, 1, 1)).toThrow(EmbeddingUnavailableError);
  });
});

describe('LocalMiniLmEmbeddingProvider: correctness', () => {
  it('declares its identity, size and a model-specific threshold', () => {
    const p = provider(fakeSession().session);
    expect(p).toMatchObject({ id: 'local-minilm', model: 'test-model', dimensions: 384, recommendedMinVectorScore: 0.25 });
  });

  it('returns one unit-length 384-d vector per text, in order', async () => {
    const { session } = fakeSession({ value: (row) => row + 1 });
    const out = await provider(session, { batchSize: 8 }).embed(['open hours', 'park car', 'open'], 'document');
    expect(out).toHaveLength(3);
    for (const v of out) { expect(v).toHaveLength(384); expect(norm(v)).toBeCloseTo(1, 6); }
    // dim0 = row+1, dim1 = 1  =>  after normalising, larger rows put more weight on dim0
    expect(out[0][0]).toBeLessThan(out[1][0]);
    expect(out[1][0]).toBeLessThan(out[2][0]);
  });

  it('feeds [CLS]/[SEP]-wrapped ids, a 1/0 attention mask that marks the padding, and zero token types', async () => {
    const { session, runs } = fakeSession();
    await provider(session, { batchSize: 8 }).embed(['open hours park', 'car'], 'query');
    const f = runs[0];
    expect([...f['input_ids'].dims]).toEqual([2, 5]);
    expect([...f['input_ids'].data]).toEqual([2n, 4n, 5n, 6n, 3n, 2n, 7n, 3n, 0n, 0n]);
    expect([...f['attention_mask'].data]).toEqual([1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 0n, 0n]);
    expect([...f['token_type_ids'].data].every((x) => x === 0n)).toBe(true);
  });

  it('omits token_type_ids when the model does not take them', async () => {
    const { session, runs } = fakeSession({ inputNames: ['input_ids', 'attention_mask'] });
    await provider(session).embed(['open'], 'query');
    expect(Object.keys(runs[0])).toEqual(['input_ids', 'attention_mask']);
  });

  it('is not affected by what padding positions hold (a padded text embeds the same alone or beside a longer one)', async () => {
    const value = (_row: number, t: number) => (t < 3 ? 1 : 9999);
    const alone = (await provider(fakeSession({ value }).session).embed(['car'], 'query'))[0];
    const padded = (await provider(fakeSession({ value }).session, { batchSize: 8 }).embed(['open hours park car', 'car'], 'query'))[1];
    expect(padded).toEqual(alone);
  });

  it('runs one text per inference call by default, so a vector never depends on its neighbours', async () => {
    const { session, runs } = fakeSession();
    await provider(session).embed(['open', 'hours', 'park'], 'document');
    expect(runs.map((r) => r['input_ids'].dims[0])).toEqual([1, 1, 1]);
  });

  it('splits a long list into batches and keeps the order', async () => {
    const { session, runs } = fakeSession({ value: (_r, _t) => 1 });
    const out = await provider(session, { batchSize: 2 }).embed(['open', 'hours', 'park', 'car', 'open'], 'document');
    expect(out).toHaveLength(5);
    expect(runs.map((r) => r['input_ids'].dims[0])).toEqual([2, 2, 1]);
  });

  it('returns an empty list for no input without loading anything', async () => {
    const load = jest.fn();
    expect(await new LocalMiniLmEmbeddingProvider({ model: 'm', load }).embed([], 'query')).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it('loads the model once and reuses it', async () => {
    const { session } = fakeSession();
    const load = jest.fn(async (): Promise<LoadedMiniLm> => ({ tokenizer: new WordPieceTokenizer(tokenizerFile, 16), session, ort: { Tensor: FakeTensor as never } }));
    const p = new LocalMiniLmEmbeddingProvider({ model: 'm', load });
    await p.warmUp();
    await p.embed(['open'], 'query');
    await p.embed(['hours'], 'query');
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('LocalMiniLmEmbeddingProvider: failure handling (callers fall back to keyword retrieval)', () => {
  it.each([
    ['a wrong hidden size', (b: number, w: number) => [b, w, 128]],
    ['a wrong batch size', (_b: number, w: number) => [3, w, D]],
    ['a flat output', (b: number) => [b, D]],
  ])('throws EmbeddingUnavailableError for %s', async (_label, shape) => {
    await expect(provider(fakeSession({ shape }).session).embed(['open'], 'query')).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });

  it('throws when the runtime fails, naming the cause', async () => {
    const p = provider(fakeSession({ fail: new Error('wasm trap') }).session);
    await expect(p.embed(['open'], 'query')).rejects.toThrow(/wasm trap/);
  });

  it('throws on an all-NaN result instead of returning a vector', async () => {
    await expect(provider(fakeSession({ value: () => NaN }).session).embed(['open'], 'query')).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });

  it('reports a failed load once, then fails fast for the retry window without re-reading the model, then tries again', async () => {
    let now = 1_000;
    const warn = jest.fn();
    const { session } = fakeSession();
    let attempts = 0;
    const load = jest.fn(async (): Promise<LoadedMiniLm> => {
      attempts++;
      if (attempts === 1) throw new EmbeddingUnavailableError('model files are missing');
      return { tokenizer: new WordPieceTokenizer(tokenizerFile, 16), session, ort: { Tensor: FakeTensor as never } };
    });
    const p = new LocalMiniLmEmbeddingProvider({ model: 'm', load, retryAfterMs: 30_000, now: () => now, warn });

    await expect(p.embed(['open'], 'query')).rejects.toThrow(/model files are missing/);
    expect(warn).toHaveBeenCalledTimes(1);
    now += 5_000;
    await expect(p.embed(['open'], 'query')).rejects.toBeInstanceOf(EmbeddingUnavailableError);
    expect(load).toHaveBeenCalledTimes(1);
    now += 30_000;
    await expect(p.embed(['open'], 'query')).resolves.toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('fails fast when too many calls are already waiting, and recovers afterwards', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { session } = fakeSession({ onRun: () => undefined });
    const slow: OrtSession = { ...session, run: async (feeds) => { await gate; return session.run(feeds); } };
    const p = provider(slow, { maxQueued: 2 });
    const first = p.embed(['open'], 'query');
    const second = p.embed(['hours'], 'query');
    await expect(p.embed(['park'], 'query')).rejects.toThrow(/busy/);
    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await expect(p.embed(['car'], 'query')).resolves.toHaveLength(1);
  });

  it('keeps serving after one call fails', async () => {
    let calls = 0;
    const { session } = fakeSession();
    const flaky: OrtSession = { ...session, run: async (feeds) => { if (++calls === 1) throw new Error('boom'); return session.run(feeds); } };
    const p = provider(flaky);
    await expect(p.embed(['open'], 'query')).rejects.toThrow(/boom/);
    await expect(p.embed(['open'], 'query')).resolves.toHaveLength(1);
  });

  it('runs concurrent calls one at a time', async () => {
    let active = 0, peak = 0;
    const { session } = fakeSession();
    const tracked: OrtSession = { ...session, run: async (feeds) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); const out = await session.run(feeds); active--; return out; } };
    const p = provider(tracked);
    await Promise.all([p.embed(['open'], 'query'), p.embed(['hours'], 'query'), p.embed(['park'], 'query')]);
    expect(peak).toBe(1);
  });
});
