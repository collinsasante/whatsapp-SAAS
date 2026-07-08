import { EscalationService } from './escalation.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EscalationService.detectHumanIntent', () => {
  const prisma = { message: { findMany: jest.fn() } } as unknown as PrismaService;
  const svc = new EscalationService(prisma);

  it.each([
    'can I talk to a human please',
    'I want to speak with a real person',
    'connect me with an agent',
    'is this a bot?',
    'stop the bot',
    'let me talk to your manager please',
    'I need a human now',
  ])('detects human-intent phrase: "%s"', (msg) => {
    expect(svc.detectHumanIntent(msg)).toBe(true);
  });

  it.each([
    'how much is the Pro plan?',
    'what are your opening hours',
    'thanks, that helps a lot',
    'can you tell me about your refund policy',
  ])('does not false-positive on ordinary questions: "%s"', (msg) => {
    expect(svc.detectHumanIntent(msg)).toBe(false);
  });
});

describe('EscalationService.detectFrustration', () => {
  const prisma = { message: { findMany: jest.fn() } } as unknown as PrismaService;
  const svc = new EscalationService(prisma);

  it('detects ALL-CAPS anger', () => {
    expect(svc.detectFrustration('THIS IS RIDICULOUS AND USELESS', [])).toBe(true);
  });

  it('does not flag a short all-caps acknowledgement', () => {
    expect(svc.detectFrustration('OK', [])).toBe(false);
  });

  it('detects an exact repeated message', () => {
    expect(svc.detectFrustration('why is my order late', ['why is my order late'])).toBe(true);
  });

  it('detects two frustration-worded messages in a row', () => {
    expect(svc.detectFrustration('this is a joke honestly', ['this service is terrible'])).toBe(true);
  });

  it('does not flag a single frustration word with no history', () => {
    expect(svc.detectFrustration('that seems a bit ridiculous to be honest', [])).toBe(false);
  });

  it('does not flag calm, unrelated consecutive messages', () => {
    expect(svc.detectFrustration('what about shipping to Kumasi', ['do you have a Pro plan'])).toBe(false);
  });
});
