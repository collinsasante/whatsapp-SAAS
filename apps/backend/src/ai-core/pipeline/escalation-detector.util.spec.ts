import { detectHumanRequest, shouldEscalateOnConfidence } from './escalation-detector.util';

describe('detectHumanRequest', () => {
  const POSITIVE_EXAMPLES = [
    'Can I speak to a human please',
    'I want to talk to an agent',
    'Please connect me with a representative',
    'Is there a real person I can talk to?',
    'I need a human agent',
    'Can you transfer me to customer service representative',
    'can I speak to someone',
    'I want to speak to someone about my order',
  ];

  it.each(POSITIVE_EXAMPLES)('detects an explicit human request: "%s"', (message) => {
    expect(detectHumanRequest(message)).toBe(true);
  });

  const NEGATIVE_EXAMPLES = [
    'How much is delivery to Accra?',
    'Do you have this in blue?',
    'What is your refund policy?',
    "I'm human, by the way",
    'This is a great product',
  ];

  it.each(NEGATIVE_EXAMPLES)('does not flag a benign message: "%s"', (message) => {
    expect(detectHumanRequest(message)).toBe(false);
  });
});

describe('shouldEscalateOnConfidence', () => {
  it('escalates at or below the low-confidence threshold', () => {
    expect(shouldEscalateOnConfidence(20)).toBe(true);
    expect(shouldEscalateOnConfidence(0)).toBe(true);
  });

  it('does not escalate above the threshold', () => {
    expect(shouldEscalateOnConfidence(21)).toBe(false);
    expect(shouldEscalateOnConfidence(95)).toBe(false);
  });

  it('does not escalate on null confidence', () => {
    expect(shouldEscalateOnConfidence(null)).toBe(false);
  });
});
