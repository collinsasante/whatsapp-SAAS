import axios, { AxiosInstance } from 'axios';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { lookup, LookupAddress } from 'dns';
import { isBlockedIp, assertSafeWebhookUrl, UnsafeWebhookUrlError } from '../manage/webhooks/webhook-url.util';

/** The caller supplied an address we refuse to fetch. The message is safe to show to the user. */
export class UnsafePageUrlError extends Error {}
/** The fetch itself failed (network, size, type, redirects). Details stay in the logs, not in the response. */
export class PageFetchError extends Error {}

export type HostResolver = (host: string) => Promise<string[]>;

const MAX_REDIRECTS = 3;
const MAX_BYTES = 500_000;
const TIMEOUT_MS = 10_000;
// Public websites are on the default ports. Refusing others stops this from probing arbitrary ports on a host.
const ALLOWED_PORTS = new Set(['', '80', '443']);
const READABLE_TYPES = /^(text\/html|text\/plain|application\/xhtml\+xml)\b/i;
const UNSAFE_MESSAGE = 'That address cannot be used. Enter the address of a public website.';

const systemResolver: HostResolver = (host) =>
  new Promise((resolve, reject) =>
    lookup(host, { all: true }, (err, addresses) => (err ? reject(err) : resolve((addresses as LookupAddress[]).map((a) => a.address)))),
  );

/**
 * DNS lookup used by the HTTP agents when they open the connection. Validating a host name and then letting the
 * HTTP client resolve it again is a race: a hostile DNS server can answer "public" for the check and "internal" for
 * the connection (DNS rebinding). Checking here, at connect time, means the address that is checked is the address
 * that is connected to.
 */
export function guardedLookup(resolver: HostResolver = systemResolver) {
  return (
    hostname: string,
    options: { all?: boolean; family?: number } | number | undefined,
    callback: (err: Error | null, address?: string | LookupAddress[], family?: number) => void,
  ): void => {
    const wantsAll = typeof options === 'object' && options?.all === true;
    resolver(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some(isBlockedIp)) return callback(new UnsafePageUrlError(UNSAFE_MESSAGE));
        const entries = addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
        if (wantsAll) return callback(null, entries);
        return callback(null, entries[0]!.address, entries[0]!.family);
      },
      (err: Error) => callback(err),
    );
  };
}

async function assertPublicUrl(raw: string, resolver: HostResolver): Promise<URL> {
  let url: URL;
  try {
    url = await assertSafeWebhookUrl(raw, { resolver });
  } catch (err) {
    if (err instanceof UnsafeWebhookUrlError) throw new UnsafePageUrlError(UNSAFE_MESSAGE);
    throw err;
  }
  if (!ALLOWED_PORTS.has(url.port)) throw new UnsafePageUrlError(UNSAFE_MESSAGE);
  return url;
}

export interface PageFetchDeps {
  resolver?: HostResolver;
  /** Test seam. The default client has redirects, proxies and unguarded DNS switched off or replaced. */
  client?: Pick<AxiosInstance, 'get'>;
}

/**
 * Fetches a public web page for the knowledge base. Every hop, including each redirect target, is validated before
 * it is requested, redirects are followed by this function (never by the HTTP client), and the connection itself is
 * restricted to the checked addresses.
 */
export async function fetchPublicPage(rawUrl: string, deps: PageFetchDeps = {}): Promise<{ html: string; finalUrl: string }> {
  const resolver = deps.resolver ?? systemResolver;
  const lookupFn = guardedLookup(resolver);
  const client =
    deps.client ??
    axios.create({
      httpAgent: new HttpAgent({ lookup: lookupFn as never }),
      httpsAgent: new HttpsAgent({ lookup: lookupFn as never }),
    });

  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current, resolver);
    let res;
    try {
      res = await client.get<string>(url.href, {
        timeout: TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: MAX_BYTES,
        maxBodyLength: MAX_BYTES,
        responseType: 'text',
        proxy: false, // HTTP(S)_PROXY from the environment would send the request somewhere this code never validated
        validateStatus: (status) => status >= 200 && status < 400,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VerzChat/1.0; +https://verzchat.com)' },
      });
    } catch (err) {
      // The agent's guard surfaces as a wrapped network error; report it as the address problem it is.
      const cause = (err as { cause?: unknown })?.cause;
      if (err instanceof UnsafePageUrlError || cause instanceof UnsafePageUrlError) throw new UnsafePageUrlError(UNSAFE_MESSAGE);
      throw new PageFetchError(`request failed: ${(err as { code?: string })?.code ?? 'error'}`);
    }

    if (res.status >= 300) {
      const location = res.headers?.['location'];
      if (typeof location !== 'string' || !location) throw new PageFetchError('redirect without a location');
      try {
        current = new URL(location, url).href;
      } catch {
        throw new PageFetchError('redirect to an invalid address');
      }
      continue;
    }

    const contentType = String(res.headers?.['content-type'] ?? '');
    if (!READABLE_TYPES.test(contentType)) throw new PageFetchError('not a readable page');
    if (typeof res.data !== 'string') throw new PageFetchError('unreadable body');
    return { html: res.data, finalUrl: url.href };
  }
  throw new PageFetchError('too many redirects');
}
