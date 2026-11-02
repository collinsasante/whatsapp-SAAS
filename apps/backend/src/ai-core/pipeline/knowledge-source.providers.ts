import { Logger, Provider } from '@nestjs/common';
import { embeddingAdapters } from '../../knowledge-base/rag/embedding-adapters';
import { createEmbeddingProvider, EMBEDDING_PROVIDER } from '../../knowledge-base/rag/embedding-provider';
import { PgVectorStore } from '../../knowledge-base/rag/pgvector-store';
import { isHybridRagEnabled } from '../../knowledge-base/rag/rag-flags';
import { VECTOR_STORE } from '../../knowledge-base/rag/vector-store';
import { PrismaService } from '../../prisma/prisma.service';
import { HybridKnowledgeContextSource } from './hybrid-knowledge-context.source';
import { KNOWLEDGE_CONTEXT_SOURCE, KbRelevantContextSource } from './knowledge-context.source';

const warmUp = (provider: ReturnType<typeof createEmbeddingProvider>) => {
  if (provider?.warmUp) void provider.warmUp().catch((err: unknown) => new Logger('EmbeddingProvider').warn(`Embedding warm-up failed: ${err instanceof Error ? err.message : String(err)}`));
  return provider;
};

/**
 * How the pipeline's knowledge source is chosen. Hybrid retrieval is OFF unless RAG_HYBRID_ENABLED=true. Even then the vector side is
 * idle unless EMBEDDING_PROVIDER names an adapter (only `local-minilm`, which also needs its model files and onnxruntime-web on the
 * host) and the database has the pgvector extension; otherwise retrieval is the existing keyword path. Evaluated at start-up, from the
 * environment.
 */
export const knowledgeSourceProviders: Provider[] = [
  KbRelevantContextSource,
  HybridKnowledgeContextSource,
  { provide: EMBEDDING_PROVIDER, useFactory: () => (isHybridRagEnabled() ? warmUp(createEmbeddingProvider(process.env, embeddingAdapters)) : null) },
  { provide: VECTOR_STORE, useFactory: (prisma: PrismaService) => (isHybridRagEnabled() ? new PgVectorStore(prisma as never) : null), inject: [PrismaService] },
  {
    provide: KNOWLEDGE_CONTEXT_SOURCE,
    useFactory: (hybrid: HybridKnowledgeContextSource, keyword: KbRelevantContextSource) => (isHybridRagEnabled() ? hybrid : keyword),
    inject: [HybridKnowledgeContextSource, KbRelevantContextSource],
  },
];
