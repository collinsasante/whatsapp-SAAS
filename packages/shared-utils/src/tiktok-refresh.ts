import { decryptCredential, encryptCredential } from './credentials-encryption';
import {
  TIKTOK_HTTP_TIMEOUT_MS, TIKTOK_TOKEN_URL, describeTikTokFailure, isTikTokReauthRequired, isTikTokRefreshExpired,
  parseTikTokTokenResponse, shouldRefreshTikTokToken, tiktokRefreshBody,
} from './tiktok-oauth';

/**
 * One pass of the TikTok access-token refresh. TikTok access tokens are short lived (expires_in; about 2 hours per the docs) and refresh tokens
 * ROTATE, so the new refresh token must be stored or the connection is lost. The worker runs this every few minutes; the function itself touches
 * no database and no network except through the injected store and fetch, so it can be tested without either.
 *
 * Concurrency: the write is conditional on the stored refresh token still being the one that was used (compare-and-set), so two runners can
 * never silently overwrite each other's rotated token. Failure handling: invalid_grant / invalid_client means the user must reconnect and is
 * recorded on the channel; anything else (network, 5xx) is left for the next pass, because the access token usually has time left.
 */
export interface TikTokChannelRow {
  id: string;
  tenantId: string;
  credentials: Record<string, unknown>;
}

export interface TikTokRefreshStore {
  listActive(): Promise<TikTokChannelRow[]>;
  /** Persist rotated credentials and clear any "reconnect needed" flag, only if the stored refreshToken still equals expectedRefreshToken. Returns whether it wrote. */
  saveRefreshed(id: string, expectedRefreshToken: string, credentials: Record<string, string>): Promise<boolean>;
  markReauthRequired(id: string, info: { error: string; at: string; logId?: string }): Promise<void>;
}

export interface TikTokRefreshDeps {
  store: TikTokRefreshStore;
  fetchFn: typeof fetch;
  key: Buffer | null;
  clientKey?: string;
  clientSecret?: string;
  now?: () => Date;
  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

export interface TikTokRefreshSummary {
  checked: number;
  refreshed: number;
  skipped: number;
  failed: number;
  reauthRequired: number;
  raced: number;
}

export async function runTikTokRefreshCycle(deps: TikTokRefreshDeps): Promise<TikTokRefreshSummary> {
  const { store, fetchFn, key, clientKey, clientSecret, log } = deps;
  const now = deps.now ?? (() => new Date());
  const summary: TikTokRefreshSummary = { checked: 0, refreshed: 0, skipped: 0, failed: 0, reauthRequired: 0, raced: 0 };

  const channels = await store.listActive();
  if (channels.length === 0) return summary;
  if (!clientKey || !clientSecret) {
    log.error('TikTok refresh skipped: TIKTOK_CLIENT_ID / TIKTOK_CLIENT_SECRET are not configured');
    summary.skipped = channels.length;
    return summary;
  }

  for (const channel of channels) {
    summary.checked += 1;
    const cred = channel.credentials;
    const storedRefresh = typeof cred['refreshToken'] === 'string' ? (cred['refreshToken'] as string) : '';
    if (!storedRefresh) {
      log.warn(`TikTok channel ${channel.id} (tenant ${channel.tenantId}) has no refresh token; it must be reconnected`);
      summary.skipped += 1;
      continue;
    }
    if (isTikTokRefreshExpired(cred['refreshExpiresAt'] as string | undefined, now())) {
      await store.markReauthRequired(channel.id, { error: 'refresh_token_expired', at: now().toISOString() });
      log.warn(`TikTok channel ${channel.id} (tenant ${channel.tenantId}): refresh token expired; reconnect required`);
      summary.reauthRequired += 1;
      continue;
    }
    if (!shouldRefreshTikTokToken(cred['tokenExpiresAt'] as string | undefined, now())) {
      summary.skipped += 1;
      continue;
    }

    let status: number;
    let bodyText: string;
    try {
      const res = await fetchFn(TIKTOK_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tiktokRefreshBody({ clientKey, clientSecret, refreshToken: decryptCredential(storedRefresh, key) }),
        signal: AbortSignal.timeout(TIKTOK_HTTP_TIMEOUT_MS),
      });
      status = res.status;
      bodyText = await res.text();
    } catch (e) {
      log.warn(`TikTok refresh for channel ${channel.id} (tenant ${channel.tenantId}) could not reach TikTok: ${e instanceof Error ? e.name : 'error'}; will retry`);
      summary.failed += 1;
      continue;
    }

    const parsed = parseTikTokTokenResponse(status, bodyText, now());
    if (!parsed.ok) {
      if (isTikTokReauthRequired(parsed)) {
        await store.markReauthRequired(channel.id, { error: parsed.error, at: now().toISOString(), logId: parsed.logId });
        log.warn(`TikTok channel ${channel.id} (tenant ${channel.tenantId}): ${describeTikTokFailure(parsed)}; reconnect required`);
        summary.reauthRequired += 1;
      } else {
        log.warn(`TikTok refresh for channel ${channel.id} (tenant ${channel.tenantId}) failed, will retry: ${describeTikTokFailure(parsed)}`);
        summary.failed += 1;
      }
      continue;
    }

    const { tokens } = parsed;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(cred)) if (typeof v === 'string') next[k] = v;
    next['accessToken'] = encryptCredential(tokens.accessToken, key);
    next['refreshToken'] = encryptCredential(tokens.refreshToken, key);
    next['tokenExpiresAt'] = tokens.accessExpiresAt;
    if (tokens.refreshExpiresAt) next['refreshExpiresAt'] = tokens.refreshExpiresAt;
    if (tokens.scopes.length > 0) next['scope'] = tokens.scopes.join(',');

    const wrote = await store.saveRefreshed(channel.id, storedRefresh, next);
    if (wrote) {
      summary.refreshed += 1;
      log.info(`TikTok token refreshed for channel ${channel.id} (tenant ${channel.tenantId}); next expiry ${tokens.accessExpiresAt}`);
    } else {
      // Another runner stored a rotated token first. Ours was valid at TikTok, but the stored one is now authoritative.
      summary.raced += 1;
      log.warn(`TikTok refresh for channel ${channel.id} (tenant ${channel.tenantId}) lost a race with another refresh; the stored token was left as is`);
    }
  }
  return summary;
}
