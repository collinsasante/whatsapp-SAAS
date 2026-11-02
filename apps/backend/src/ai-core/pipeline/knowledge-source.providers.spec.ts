import { Test } from '@nestjs/testing';
import { ApprovedCorrectionsService } from '../../ai-learning/corrections/approved-corrections.service';
import { KnowledgeBaseService } from '../../knowledge-base/knowledge-base.service';
import { EMBEDDING_PROVIDER } from '../../knowledge-base/rag/embedding-provider';
import { VECTOR_STORE } from '../../knowledge-base/rag/vector-store';
import { PrismaService } from '../../prisma/prisma.service';
import { HybridKnowledgeContextSource } from './hybrid-knowledge-context.source';
import { KNOWLEDGE_CONTEXT_SOURCE, KbRelevantContextSource } from './knowledge-context.source';
import { knowledgeSourceProviders } from './knowledge-source.providers';

async function resolve(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  delete process.env['RAG_HYBRID_ENABLED'];
  delete process.env['EMBEDDING_PROVIDER'];
  delete process.env['EMBEDDING_MODEL_DIR'];
  for (const [key, value] of Object.entries(env)) if (value !== undefined) process.env[key] = value;
  try {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: KnowledgeBaseService, useValue: { getActiveForRetrieval: jest.fn(), getRelevant: jest.fn() } },
        { provide: ApprovedCorrectionsService, useValue: { getGuidanceBlock: jest.fn() } },
        { provide: PrismaService, useValue: {} },
        ...knowledgeSourceProviders,
      ],
    }).compile();
    return { source: moduleRef.get(KNOWLEDGE_CONTEXT_SOURCE), embedder: moduleRef.get(EMBEDDING_PROVIDER), store: moduleRef.get(VECTOR_STORE) };
  } finally {
    for (const key of ['RAG_HYBRID_ENABLED', 'EMBEDDING_PROVIDER', 'EMBEDDING_MODEL_DIR']) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
}

describe('knowledge source selection (the real provider definitions, resolved by the Nest container)', () => {
  it('uses the existing keyword source by default, with no embedding provider and no vector store', async () => {
    const { source, embedder, store } = await resolve({});
    expect(source).toBeInstanceOf(KbRelevantContextSource);
    expect(embedder).toBeNull();
    expect(store).toBeNull();
  });

  it.each(['TRUE', '1', 'yes', 'false', ''])('stays on the keyword source for RAG_HYBRID_ENABLED=%j', async (value) => {
    expect((await resolve({ RAG_HYBRID_ENABLED: value })).source).toBeInstanceOf(KbRelevantContextSource);
  });

  it('switches to the hybrid source only for the exact value "true", and still has no embedding provider without one configured', async () => {
    const { source, embedder, store } = await resolve({ RAG_HYBRID_ENABLED: 'true' });
    expect(source).toBeInstanceOf(HybridKnowledgeContextSource);
    expect(embedder).toBeNull();
    expect(store).not.toBeNull();
  });

  it('fails loudly at start-up if a provider is named that this build has no adapter for', async () => {
    await expect(resolve({ RAG_HYBRID_ENABLED: 'true', EMBEDDING_PROVIDER: 'openai' })).rejects.toThrow(/no adapter/);
  });

  it('binds the local MiniLM provider when it is named, and starts normally even though the model directory is wrong (retrieval stays on keywords)', async () => {
    const { source, embedder } = await resolve({ RAG_HYBRID_ENABLED: 'true', EMBEDDING_PROVIDER: 'local-minilm', EMBEDDING_MODEL_DIR: '/does/not/exist' });
    expect(source).toBeInstanceOf(HybridKnowledgeContextSource);
    expect(embedder).toMatchObject({ id: 'local-minilm', dimensions: 384, recommendedMinVectorScore: 0.25 });
    await expect(embedder.embed(['hello'], 'query')).rejects.toThrow(/could not be loaded/);
  });

  it('ignores EMBEDDING_PROVIDER while hybrid retrieval is off', async () => {
    expect((await resolve({ EMBEDDING_PROVIDER: 'openai' })).embedder).toBeNull();
  });
});
