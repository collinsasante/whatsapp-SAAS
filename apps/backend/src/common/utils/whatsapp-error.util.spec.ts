import { mapWhatsAppErrorCode, FAILURE_CATEGORY_LABELS } from './whatsapp-error.util';

describe('whatsapp-error.util', () => {
  describe('mapWhatsAppErrorCode', () => {
    it('maps known "not on WhatsApp" codes', () => {
      expect(mapWhatsAppErrorCode(131026)).toBe('not_on_whatsapp');
      expect(mapWhatsAppErrorCode(133010)).toBe('not_on_whatsapp');
    });

    it('maps known "24-hour window expired" codes', () => {
      expect(mapWhatsAppErrorCode(131047)).toBe('window_expired');
    });

    it('maps known template-issue codes', () => {
      expect(mapWhatsAppErrorCode(132000)).toBe('template_issue');
      expect(mapWhatsAppErrorCode(132005)).toBe('template_issue');
    });

    it('maps known rate-limit codes', () => {
      expect(mapWhatsAppErrorCode(130429)).toBe('rate_limited');
      expect(mapWhatsAppErrorCode(131048)).toBe('rate_limited');
    });

    it('maps known account-restricted codes', () => {
      expect(mapWhatsAppErrorCode(190)).toBe('account_restricted');
    });

    it('falls back to "other" for unmapped or missing codes', () => {
      expect(mapWhatsAppErrorCode(999999)).toBe('other');
      expect(mapWhatsAppErrorCode(null)).toBe('other');
      expect(mapWhatsAppErrorCode(undefined)).toBe('other');
    });
  });

  it('has a human label for every category', () => {
    const categories = Object.keys(FAILURE_CATEGORY_LABELS);
    expect(categories).toEqual(
      expect.arrayContaining(['not_on_whatsapp', 'window_expired', 'template_issue', 'rate_limited', 'account_restricted', 'other']),
    );
    for (const label of Object.values(FAILURE_CATEGORY_LABELS)) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
