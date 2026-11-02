import { Logger } from '@nestjs/common';
import { EmbeddingProviderFactory } from './embedding-provider';
import { createLocalMiniLmProvider } from './local-minilm/minilm-loader';

const logger = new Logger('EmbeddingProvider');

/**
 * Every embedding adapter this build can run, by the name used in EMBEDDING_PROVIDER. Importing this file loads no model and no
 * native or WASM runtime; those are resolved the first time an embedding is requested.
 */
export const embeddingAdapters: Record<string, EmbeddingProviderFactory> = {
  'local-minilm': (env) => createLocalMiniLmProvider(env, { warn: (message) => logger.warn(message) }),
};
