import { buildRetrievalQuery } from '../knowledge-retrieval.util';
import { LexicalReranker, RerankCandidate } from './reranker';

const cand = (key: string, title: string, text: string, fusedScore: number, vectorScore?: number): RerankCandidate => ({ key, title, text, fusedScore, vectorScore });
const rerank = (query: string, candidates: RerankCandidate[], limit = 5) => new LexicalReranker().rerank(buildRetrievalQuery(query), query, candidates, limit).map((c) => c.key);

describe('LexicalReranker', () => {
  it('prefers the candidate that covers the customer\'s words even when its fusion score is slightly lower', () => {
    const order = rerank('how much is delivery on a weekday', [
      cand('cakes', 'Custom cakes', 'We make cakes for birthdays and weddings.', 0.0325),
      cand('delivery', 'Local delivery', 'The delivery fee is $4 Monday to Friday. Delivery is free over $60.', 0.0320),
    ]);
    expect(order[0]).toBe('delivery');
  });

  it('rewards a title match', () => {
    const order = rerank('parking', [
      cand('a', 'Contact details', 'Call us. There is parking nearby.', 0.03),
      cand('b', 'Location and parking', 'Find us on Orchard Row.', 0.03),
    ]);
    expect(order[0]).toBe('b');
  });

  it('spreads the picks so a near-duplicate does not crowd out a different relevant article', () => {
    const duplicate = 'The delivery fee is $4 Monday to Friday between ten and three within five kilometres of the shop.';
    const order = rerank('delivery fee and refund policy', [
      cand('d1', 'Local delivery', duplicate, 0.033),
      cand('d2', 'Delivery details', duplicate, 0.0325),
      cand('r1', 'Cancellations and refunds', 'Orders can be cancelled for a full refund of the deposit.', 0.030),
    ], 2);
    expect(order).toContain('r1');
  });

  it('honours the limit and returns nothing for no candidates', () => {
    expect(rerank('cake', [cand('a', 'A', 'cake', 0.03), cand('b', 'B', 'cake', 0.02), cand('c', 'C', 'cake', 0.01)], 2)).toHaveLength(2);
    expect(rerank('cake', [])).toEqual([]);
  });

  it('is deterministic', () => {
    const candidates = [cand('a', 'A', 'cake price', 0.03), cand('b', 'B', 'cake price', 0.03)];
    expect(rerank('cake price', candidates)).toEqual(rerank('cake price', candidates));
  });
});
