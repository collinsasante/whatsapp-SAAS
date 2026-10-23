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

/** Expands any valid IPv6 text form (compressed, mixed dotted-quad) to its 16 bytes. */
function ipv6ToBytes(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[2]!.split('.').map(Number);
    if (o.some((n) => n > 255)) return null;
    text = `${dotted[1]}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 255);
  }
  return bytes.length === 16 ? bytes : null;
}

function isBlockedV6(ip: string): boolean {
  const b = ipv6ToBytes(ip);
  if (!b) return true; // unparseable: treat as blocked
  const v4 = (o: number) => `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`;
  const zeroPrefix = b.slice(0, 10).every((x) => x === 0);
  // IPv4-mapped (::ffff:a.b.c.d): judged by the embedded IPv4 address. Node's URL parser rewrites
  // ::ffff:10.0.0.1 to the hex form ::ffff:a00:1, so every spelling lands here.
  if (zeroPrefix && b[10] === 0xff && b[11] === 0xff) return isBlockedV4(v4(12));
  // ::/96 covers the unspecified address, loopback and the deprecated IPv4-compatible form (::7f00:1).
  if (zeroPrefix && b[10] === 0 && b[11] === 0) return true;
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true; // NAT64 (64:ff9b::/32 and 64:ff9b:1::/48) reaches any IPv4 address
  if (b[0] === 0x20 && b[1] === 0x02) return isBlockedV4(v4(2)); // 6to4 carries an IPv4 address in bits 16-48
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return true; // Teredo
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // documentation
  if (b[0] === 0x01 && b.slice(1, 8).every((x) => x === 0)) return true; // discard-only 100::/64
  if (b[0] === 0xff) return true; // multicast
  if ((b[0]! & 0xfe) === 0xfc) return true; // unique-local fc00::/7
  if (b[0] === 0xfe && (b[1]! & 0xc0) >= 0x80) return true; // link-local fe80::/10 and deprecated site-local fec0::/10
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedV4(ip);
  if (version === 6) return isBlockedV6(ip);
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
