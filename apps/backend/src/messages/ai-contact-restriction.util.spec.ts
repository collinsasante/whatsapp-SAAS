import { isAiAllowedForContact } from './ai-contact-restriction.util';

describe('isAiAllowedForContact', () => {
  it('allows every contact when no restriction is set (null)', () => {
    expect(isAiAllowedForContact(null, '+233509702118')).toBe(true);
  });

  it('allows every contact when no restriction is set (undefined)', () => {
    expect(isAiAllowedForContact(undefined, '+233509702118')).toBe(true);
  });

  it('allows every contact when the restriction is an empty string', () => {
    expect(isAiAllowedForContact('', '+233509702118')).toBe(true);
  });

  it('allows only the restricted number when set, formatted identically', () => {
    expect(isAiAllowedForContact('+233509702118', '+233509702118')).toBe(true);
    expect(isAiAllowedForContact('+233509702118', '+16179388887')).toBe(false);
  });

  it('normalizes formatting differences (spaces, dashes) before comparing', () => {
    expect(isAiAllowedForContact('+233 50 970 2118', '+233509702118')).toBe(true);
    expect(isAiAllowedForContact('233-50-970-2118', '+233509702118')).toBe(true);
  });

  it('blocks every other contact once a restriction is set', () => {
    expect(isAiAllowedForContact('+233509702118', '+233543206335')).toBe(false);
  });
});
