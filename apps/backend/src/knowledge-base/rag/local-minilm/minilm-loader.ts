import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { EmbeddingProvider, EmbeddingUnavailableError } from '../embedding-provider';
import { LoadedMiniLm, LocalMiniLmEmbeddingProvider, OrtRuntime, OrtSession } from './minilm-embedding-provider';
import { TokenizerFile, WordPieceTokenizer } from './wordpiece-tokenizer';

/**
 * Files of Xenova/all-MiniLM-L6-v2 at revision 751bff37182d3f1213fa05d7196b954e230abad9 (the int8-quantised ONNX export of
 * sentence-transformers/all-MiniLM-L6-v2, Apache-2.0; see apps/backend/third-party/all-MiniLM-L6-v2). They are pinned by SHA-256 because
 * a vector is only comparable with vectors from the same weights: a different file would silently make every stored vector wrong.
 * The files are NOT in this repository or in the production image; they are placed on the host and pointed to by EMBEDDING_MODEL_DIR.
 */
export const MINILM_MODEL_ID = 'Xenova/all-MiniLM-L6-v2@751bff3:int8';
export const MINILM_FILES = {
  tokenizer: { relativePath: 'tokenizer.json', sha256: 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0' },
  weights: { relativePath: path.join('onnx', 'model_quantized.onnx'), sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1' },
} as const;
export const MINILM_MAX_TOKENS = 256;

/** onnxruntime-web as the loader uses it: the session factory and the single-thread switch. */
export interface OrtWebModule extends OrtRuntime {
  InferenceSession: { create(model: Uint8Array, options: { executionProviders: string[] }): Promise<OrtSession> };
  env: { wasm: { numThreads?: number } };
}

export type OrtModuleLoader = () => OrtWebModule;

/**
 * onnxruntime-web is deliberately not a dependency of this package yet (see docs/VERZAI_V2_HYBRID_RAG.md). It is resolved at the moment
 * the model is first needed, so a build without it starts normally and the provider reports itself unavailable.
 */
export const defaultOrtLoader: OrtModuleLoader = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('onnxruntime-web') as OrtWebModule;
  } catch (err) {
    throw new EmbeddingUnavailableError(`onnxruntime-web is not installed in this build (${err instanceof Error ? err.message : String(err)})`);
  }
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function readVerified(dir: string, file: { relativePath: string; sha256: string }): Promise<Buffer> {
  const full = path.join(dir, file.relativePath);
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(full);
  } catch (err) {
    throw new EmbeddingUnavailableError(`cannot read ${file.relativePath} in EMBEDDING_MODEL_DIR (${err instanceof Error ? err.message : String(err)})`);
  }
  if (sha256(bytes) !== file.sha256) throw new EmbeddingUnavailableError(`${file.relativePath} does not match the pinned ${MINILM_MODEL_ID} file (SHA-256 mismatch)`);
  return bytes;
}

export async function loadMiniLm(modelDir: string, loadOrt: OrtModuleLoader = defaultOrtLoader): Promise<LoadedMiniLm> {
  if (!modelDir.trim()) throw new EmbeddingUnavailableError('EMBEDDING_MODEL_DIR is not set');
  const ort = loadOrt();
  // One after the other, so the first problem reported is always the same one.
  const tokenizerBytes = await readVerified(modelDir, MINILM_FILES.tokenizer);
  const weights = await readVerified(modelDir, MINILM_FILES.weights);
  const tokenizer = new WordPieceTokenizer(JSON.parse(tokenizerBytes.toString('utf8')) as TokenizerFile, MINILM_MAX_TOKENS);
  ort.env.wasm.numThreads = 1; // multi-threaded WASM did not start under Node here, and one thread keeps CPU use predictable
  const session = await ort.InferenceSession.create(weights, { executionProviders: ['wasm'] });
  return { tokenizer, session, ort };
}

/** Adapter registered under EMBEDDING_PROVIDER=local-minilm. Construction never touches the disk: loading happens on first use. */
export function createLocalMiniLmProvider(
  env: Record<string, string | undefined>,
  deps: { loadOrt?: OrtModuleLoader; warn?: (message: string) => void } = {},
): EmbeddingProvider {
  const dir = env['EMBEDDING_MODEL_DIR'] ?? '';
  return new LocalMiniLmEmbeddingProvider({ model: MINILM_MODEL_ID, load: () => loadMiniLm(dir, deps.loadOrt), warn: deps.warn });
}
