import { assertNotSimulatedRecipient, isSimulatedPhone, normalizePhone, SIMULATED_PHONE_PREFIX, SimulatedRecipientError, simulatedPhoneFor } from '@whatsapp-platform/shared-utils';

describe('simulated recipient (reserved number range)', () => {
  describe('simulatedPhoneFor', () => {
    it('is stable for a seed and differs between seeds', () => {
      expect(simulatedPhoneFor('user-1')).toBe(simulatedPhoneFor('user-1'));
      expect(simulatedPhoneFor('user-1')).not.toBe(simulatedPhoneFor('user-2'));
    });

    it('always produces +000 and 10 digits, for any seed', () => {
      for (const seed of ['', 'a', 'user-1', 'x'.repeat(500), '00000000-0000-0000-0000-000000000000', 'ünïcödé ✓']) {
        expect(simulatedPhoneFor(seed)).toMatch(/^\+000\d{10}$/);
      }
      const seen = new Set<string>();
      for (let i = 0; i < 2000; i++) {
        const phone = simulatedPhoneFor(`generated-user-${i}-${Math.random()}`);
        expect(phone).toMatch(/^\+000\d{10}$/);
        expect(isSimulatedPhone(phone)).toBe(true);
        seen.add(phone);
      }
      expect(seen.size).toBeGreaterThan(1900); // the range is wide enough that seeds almost never collide
    });

    it('survives the normalisation the inbound pipeline applies, and is still recognised afterwards', () => {
      for (const seed of ['user-1', 'abc']) {
        const p = simulatedPhoneFor(seed);
        expect(normalizePhone(p)).toBe(p);
        expect(normalizePhone(p.replace('+', ''))).toBe(p);
        expect(isSimulatedPhone(normalizePhone(p.replace('+', '')))).toBe(true);
      }
    });

    it('the prefix is the documented one', () => expect(SIMULATED_PHONE_PREFIX).toBe('000'));
  });

  describe('isSimulatedPhone', () => {
    it.each(['+0003458935471', '0003458935471', '+000 345 893 5471', '000-345-893-5471', '(000)3458935471'])('accepts %s', (v) => expect(isSimulatedPhone(v)).toBe(true));

    it.each([
      ['a real Ghana number', '+233555000111'], ['a real US number', '+14155552671'], ['a UK number', '+447911123456'],
      ['a number containing 000 later', '+233000123456'], ['+001 prefix', '+0013458935471'], ['+000 but too short', '+000123456'],
      ['+000 but too long', '+00034589354711'], ['a Business-Scoped User ID', 'GH.1115168874544553'], ['an empty string', ''], ['letters', 'hello'],
    ])('rejects %s', (_l, v) => expect(isSimulatedPhone(v)).toBe(false));

    it.each([[null], [undefined], [0], [3458935471], [{}], [['+0003458935471']], [{ jid: '0003458935471@s.whatsapp.net' }], [true]])('is false, never throws, for a non-string (%p)', (v) => {
      expect(isSimulatedPhone(v)).toBe(false);
    });
  });

  describe('assertNotSimulatedRecipient', () => {
    it('throws SimulatedRecipientError for a simulated number', () => {
      expect(() => assertNotSimulatedRecipient('+0003458935471')).toThrow(SimulatedRecipientError);
    });

    it('does nothing for a real number, a BSUID or a non-string', () => {
      for (const v of ['+233555000111', 'GH.1115168874544553', undefined, null, { jid: 'x' }]) expect(() => assertNotSimulatedRecipient(v)).not.toThrow();
    });
  });
});
