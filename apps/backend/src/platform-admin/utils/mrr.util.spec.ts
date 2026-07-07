import { classifyMrrMovement } from './mrr.util';

describe('classifyMrrMovement', () => {
  it('classifies a brand new paying tenant as NEW', () => {
    expect(classifyMrrMovement(0, 50)).toBe('NEW');
  });

  it('classifies a tenant with no MRR either day as NONE (never paid, still hasn\'t)', () => {
    expect(classifyMrrMovement(0, 0)).toBe('NONE');
  });

  it('classifies a tenant whose subscription ended as CHURNED', () => {
    expect(classifyMrrMovement(50, 0)).toBe('CHURNED');
  });

  it('classifies an MRR increase as EXPANSION', () => {
    expect(classifyMrrMovement(50, 100)).toBe('EXPANSION');
  });

  it('classifies an MRR decrease (but still paying) as CONTRACTION', () => {
    expect(classifyMrrMovement(100, 50)).toBe('CONTRACTION');
  });

  it('classifies unchanged MRR as RETAINED', () => {
    expect(classifyMrrMovement(50, 50)).toBe('RETAINED');
  });

  it('treats negative previous MRR the same as zero (defensive against bad data)', () => {
    expect(classifyMrrMovement(-10, 50)).toBe('NEW');
  });
});
