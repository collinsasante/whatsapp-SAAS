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
    'I hate chatting with AI',
    "I don't want to talk to a bot",
    'stop being a robot and get me a real answer',
    // Natural and informal phrasing, including Ghanaian English and Pidgin.
    'I need to talk to someone',
    'I need to speak with somebody please',
    'let me talk to somebody',
    'abeg make I talk to somebody',
    'I wan talk to person',
    'I want a human',
    'I need an agent',
    'get me a real person',
    'put me through to someone',
    'put me through to your manager',
    'transfer me to the owner',
    'can someone call me',
    'please call me',
    'give me a call',
    'agent please',
    'can I talk to the owner',
    'let me speak to your boss',
    'who is in charge here',
    "I don't want to talk to a machine",
    'enough of this bot',
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
    // Ordinary sentences that share words with a request for a person.
    'You can call me Kwame',
    'call me Kwame when it is ready',
    'I need a person to deliver to my house',
    'I want to talk about the shea butter',
    'someone told me about your shop',
    'my sister will call me when she arrives',
    'the manager of my shop wants 50 units',
    'is the owner of the brand Ghanaian?',
    'please send the agent fee invoice',
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
