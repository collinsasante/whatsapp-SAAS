import { createHash } from 'crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { createEmbeddingProvider, EmbeddingUnavailableError } from '../embedding-provider';
import { embeddingAdapters } from '../embedding-adapters';
import { defaultOrtLoader, loadMiniLm, MINILM_FILES, MINILM_MODEL_ID } from './minilm-loader';

describe('loadMiniLm: refuses anything but the pinned model files', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'minilm-test-')); mkdirSync(path.join(dir, 'onnx')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const ort = () => { throw new Error('the runtime must not be used when the files are wrong'); };

  it('fails clearly when EMBEDDING_MODEL_DIR is not set', async () => {
    await expect(loadMiniLm('', ort as never)).rejects.toThrow(/EMBEDDING_MODEL_DIR is not set/);
  });

  // When the package IS resolvable (a developer machine with it installed) there is nothing to refuse, so this only runs where it is absent.
  const ortInstalled = (() => { try { require.resolve('onnxruntime-web'); return true; } catch { return false; } })();
  (ortInstalled ? it.skip : it)('fails clearly when onnxruntime-web is not installed (the state of the production image today)', () => {
    expect(() => defaultOrtLoader()).toThrow(EmbeddingUnavailableError);
    expect(() => defaultOrtLoader()).toThrow(/onnxruntime-web is not installed/);
  });

  it('fails clearly when the model files are missing', async () => {
    await expect(loadMiniLm(dir, (() => ({ env: { wasm: {} } })) as never)).rejects.toThrow(/cannot read tokenizer\.json/);
  });

  it('rejects files whose SHA-256 differs from the pinned ones', async () => {
    writeFileSync(path.join(dir, MINILM_FILES.tokenizer.relativePath), '{"not":"the tokenizer"}');
    writeFileSync(path.join(dir, MINILM_FILES.weights.relativePath), 'not the weights');
    expect(createHash('sha256').update('not the weights').digest('hex')).not.toBe(MINILM_FILES.weights.sha256);
    await expect(loadMiniLm(dir, (() => ({ env: { wasm: {} } })) as never)).rejects.toThrow(/SHA-256 mismatch/);
  });
});

describe('the adapter registry', () => {
  it('registers local-minilm and nothing that calls a hosted API', () => {
    expect(Object.keys(embeddingAdapters)).toEqual(['local-minilm']);
  });

  it('builds the provider from EMBEDDING_PROVIDER=local-minilm without touching the disk or the runtime', () => {
    const provider = createEmbeddingProvider({ EMBEDDING_PROVIDER: 'local-minilm', EMBEDDING_MODEL_DIR: '/does/not/exist' }, embeddingAdapters);
    expect(provider).toMatchObject({ id: 'local-minilm', model: MINILM_MODEL_ID, dimensions: 384 });
  });

  it('gives no provider when EMBEDDING_PROVIDER is unset, and rejects an unknown name', () => {
    expect(createEmbeddingProvider({}, embeddingAdapters)).toBeNull();
    expect(() => createEmbeddingProvider({ EMBEDDING_PROVIDER: 'openai' }, embeddingAdapters)).toThrow(/no adapter/);
  });

  it('reports unavailable (so retrieval uses keywords) when the model directory is wrong, rather than throwing at construction', async () => {
    const provider = createEmbeddingProvider({ EMBEDDING_PROVIDER: 'local-minilm', EMBEDDING_MODEL_DIR: '/does/not/exist' }, embeddingAdapters)!;
    await expect(provider.embed(['hello'], 'query')).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });
});
