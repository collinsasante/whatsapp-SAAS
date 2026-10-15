import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * Guards outbound tenant webhooks against SSRF: tenant admins choose webhook URLs, and the
 * backend/worker POST to them from inside our network. Only http(s) URLs whose host resolves
 * exclusively to public addresses are allowed. Set WEBHOOK_ALLOW_PRIVATE_URLS=true only for
 * local development.
 */
export async function assertPublicWebhookUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Webhook URL is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Webhook URL must use http or https');
  }
  if (url.username || url.password) {
    throw new Error('Webhook URL must not contain credentials');
  }
  if (process.env['WEBHOOK_ALLOW_PRIVATE_URLS'] === 'true') return;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (!addresses.length) throw new Error('Webhook host does not resolve');
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error('Webhook URL must point to a public internet address');
    }
  }
}

export function isPrivateAddress(address: string): boolean {
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast / reserved
    );
  }
  const v6 = address.toLowerCase();
  return (
    v6 === '::' || v6 === '::1' ||
    v6.startsWith('fc') || v6.startsWith('fd') || // unique local
    v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || // link-local
    v6.startsWith('ff') // multicast
  );
}
