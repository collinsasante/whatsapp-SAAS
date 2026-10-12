import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';

// WhatsApp's Business-Scoped User ID (BSUID) -- Meta sends this instead of a
// real phone number ("from"/"wa_id") once a customer enables a WhatsApp
// username and hasn't messaged this business in 30+ days. Format: a 2-letter
// country code, a literal dot, then up to ~20 digits. Meta's Send API accepts
// this exact string in the "to" field in place of a phone number, so callers
// store/pass it through the same `phone` field as a real number -- it must
// never be mangled by digit-stripping below, which would corrupt it into an
// unusable value (losing the "CC." prefix the Send API requires).
const BSUID_PATTERN = /^[A-Z]{2}\.\d+$/;

export function normalizePhone(phone: string): string {
  if (BSUID_PATTERN.test(phone)) return phone;
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

export function validatePhone(phone: string): boolean {
  try {
    return isValidPhoneNumber(phone);
  } catch {
    return false;
  }
}

export function formatPhoneForDisplay(phone: string): string {
  try {
    const parsed = parsePhoneNumber(phone);
    return parsed.formatInternational();
  } catch {
    return phone;
  }
}
