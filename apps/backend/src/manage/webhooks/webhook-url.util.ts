import { lookup } from 'dns/promises';
import { isIP } from 'net';

export class UnsafeWebhookUrlError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
];

function isBlockedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
  });
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedV4(ip);
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    // IPv4-mapped addresses. Node's URL parser rewrites ::ffff:10.0.0.1 to the hex form ::ffff:a00:1,
    // so both spellings must resolve to the embedded IPv4 address before it is checked.
    const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isBlockedV4(dotted[1]!);
    const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1]!, 16);
      const lo = parseInt(hex[2]!, 16);
      return isBlockedV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (lower.startsWith('64:ff9b:')) return true; // NAT64 can reach any IPv4 address, including private ones
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower); // unique-local fc00::/7, link-local fe80::/10
  }
  return true; // not an IP at all: treat as blocked
}

type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

/**
 * Webhook URLs are fetched by the server, so a tenant-supplied URL must not reach internal services
 * (cloud metadata, the database host, other containers). Set WEBHOOK_ALLOW_PRIVATE_URLS=true only for
 * a private deployment that deliberately posts to internal addresses.
 */
export async function assertSafeWebhookUrl(
  raw: string,
  opts: { allowPrivate?: boolean; resolver?: Resolver } = {},
): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new UnsafeWebhookUrlError('Enter a valid URL, for example https://example.com/webhook.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeWebhookUrlError('The URL must start with http:// or https://.');
  if (url.username || url.password) throw new UnsafeWebhookUrlError('The URL must not contain a username or password. Use a custom header instead.');
  if (opts.allowPrivate) return url;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new UnsafeWebhookUrlError('That address points to a private network and cannot be used for a webhook.');
  }
  const addresses = isIP(host) ? [host] : await (opts.resolver ?? defaultResolver)(host).catch(() => []);
  if (addresses.length === 0) throw new UnsafeWebhookUrlError('We could not resolve that host name.');
  if (addresses.some(isBlockedIp)) throw new UnsafeWebhookUrlError('That address points to a private network and cannot be used for a webhook.');
  return url;
}
