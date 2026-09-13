import { computeOverallScore, computeSeverity, classifyQualityBand, needsHumanReview, DEFAULT_THRESHOLDS } from './dimension-scoring.util';

describe('computeOverallScore', () => {
  it('returns null when no dimensions are present', () => {
    expect(computeOverallScore({})).toBeNull();
  });

  it('re-normalizes weights across only the applicable dimensions', () => {
    // Only two dimensions present -- their weights (0.15 + 0.2) should be
    // re-normalized to sum to 1, not silently penalized for the other 8 being absent.
    const score = computeOverallScore({ contextUnderstanding: 5, accuracy: 5 });
    expect(score).toBe(5);
  });

  it('computes a genuinely weighted average, not a plain mean', () => {
    // accuracy (weight 0.2) scored 0, contextUnderstanding (weight 0.15) scored 5.
    // Plain mean would be 2.5; weighted mean should be lower since accuracy weighs more.
    const score = computeOverallScore({ contextUnderstanding: 5, accuracy: 0 });
    expect(score).toBeLessThan(2.5);
  });

  it('never lets an inapplicable dimension drag the score down', () => {
    const fullScore = computeOverallScore({ naturalness: 5, accuracy: 5, contextUnderstanding: 5, intentHandling: 5, conversationContinuity: 5, responseAppropriateness: 5 });
    expect(fullScore).toBe(5);
  });
});

describe('computeSeverity', () => {
  it('returns null for no failures', () => {
    expect(computeSeverity([])).toBeNull();
  });

  it('escalates to the worst severity across multiple categories', () => {
    expect(computeSeverity(['TOO_VERBOSE', 'WRONG_PAYMENT_STATE'])).toBe('CRITICAL');
  });

  it('defaults an unmapped category to MEDIUM rather than dropping severity', () => {
    expect(computeSeverity(['OTHER'])).toBe('MEDIUM');
  });
});

describe('classifyQualityBand', () => {
  it('classifies each band correctly at the boundaries', () => {
    expect(classifyQualityBand(4.5, DEFAULT_THRESHOLDS)).toBe('EXCELLENT');
    expect(classifyQualityBand(3.8, DEFAULT_THRESHOLDS)).toBe('GOOD');
    expect(classifyQualityBand(3.0, DEFAULT_THRESHOLDS)).toBe('NEEDS_REVIEW');
    expect(classifyQualityBand(2.99, DEFAULT_THRESHOLDS)).toBe('POOR');
    expect(classifyQualityBand(null)).toBe('POOR');
  });
});

describe('needsHumanReview', () => {
  const base = {
    overallScore: 5, severity: null, falseActionClaim: false, falseSuccessClaim: false,
    unnecessaryHandoff: false, customerCorrectionDetected: false, evaluatorConfidence: 0.9,
  };

  it('is false for a clean, high-scoring evaluation', () => {
    expect(needsHumanReview(base)).toBe(false);
  });

  it('is true for a false payment/action claim regardless of score', () => {
    expect(needsHumanReview({ ...base, falseSuccessClaim: true })).toBe(true);
  });

  it('is true for CRITICAL or HIGH severity', () => {
    expect(needsHumanReview({ ...base, severity: 'CRITICAL' })).toBe(true);
    expect(needsHumanReview({ ...base, severity: 'HIGH' })).toBe(true);
    expect(needsHumanReview({ ...base, severity: 'LOW' })).toBe(false);
  });

  it('is true below the needsReview threshold', () => {
    expect(needsHumanReview({ ...base, overallScore: 2.5 })).toBe(true);
  });

  it('is true when evaluator confidence is low', () => {
    expect(needsHumanReview({ ...base, evaluatorConfidence: 0.2 })).toBe(true);
  });

  it('is true for an unnecessary handoff or a detected customer correction', () => {
    expect(needsHumanReview({ ...base, unnecessaryHandoff: true })).toBe(true);
    expect(needsHumanReview({ ...base, customerCorrectionDetected: true })).toBe(true);
  });
});
