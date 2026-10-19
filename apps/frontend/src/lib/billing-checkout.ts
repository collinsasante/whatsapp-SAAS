/** Same shape check the server applies (billing.service.ts EMAIL_PATTERN); the server remains the authority. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleEmail(value: string | null | undefined): boolean {
  return !!value && EMAIL_PATTERN.test(value.trim());
}
