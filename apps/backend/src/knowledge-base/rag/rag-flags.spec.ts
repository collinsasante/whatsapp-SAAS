import { isHybridRagEnabled } from './rag-flags';

describe('isHybridRagEnabled', () => {
  it.each([[{ RAG_HYBRID_ENABLED: 'true' }, true], [{}, false], [{ RAG_HYBRID_ENABLED: '' }, false], [{ RAG_HYBRID_ENABLED: 'TRUE' }, false], [{ RAG_HYBRID_ENABLED: '1' }, false], [{ RAG_HYBRID_ENABLED: 'yes' }, false], [{ RAG_HYBRID_ENABLED: 'false' }, false]])(
    'for %j is %s', (env, expected) => { expect(isHybridRagEnabled(env)).toBe(expected); },
  );
});
