// A customer who uses a WhatsApp username is addressed by Business-Scoped User ID ("CC.digits", or "CC.ENT.digits" for a
// parent ID). The Cloud API wants that value in `recipient`; a phone number still goes in `to`.
const BSUID_RECIPIENT = /^[A-Z]{2}\.(?:[A-Za-z0-9]+\.)*[A-Za-z0-9]+$/;

export function recipientField(to: string): { recipient: string } | { to: string } {
  return BSUID_RECIPIENT.test(to) ? { recipient: to } : { to };
}
