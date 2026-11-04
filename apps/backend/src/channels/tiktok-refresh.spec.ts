import { decryptCredential, encryptCredential, parseEncryptionKey, runTikTokRefreshCycle, TikTokRefreshStore } from '@whatsapp-platform/shared-utils';

const KEY = parseEncryptionKey(Buffer.alloc(32, 7).toString('base64'));
const NOW = new Date('2026-11-04T12:00:00.000Z');
const OLD = { access: 'act.OLD-ACCESS-TOKEN-1', refresh: 'rft.OLD-REFRESH-TOKEN-1' };
const NEWT = { access: 'act.NEW-ACCESS-TOKEN-2', refresh: 'rft.NEW-REFRESH-TOKEN-2' };
const CLIENT_SECRET = 'CLIENT-SECRET-VALUE-9f2c';

const flat = (o: object) => ({ status: 200, text: () => Promise.resolve(JSON.stringify(o)) });
const refreshed = { access_token: NEWT.access, expires_in: 7200, refresh_token: NEWT.refresh, refresh_expires_in: 15552000, open_id: 'open-id-123', scope: 'user.info.basic', token_type: 'Bearer' };

function channel(over: Record<string, unknown> = {}, id = 'ch-1', tenantId = 'tenant-A') {
  return {
    id, tenantId,
    credentials: {
      accessToken: encryptCredential(OLD.access, KEY), refreshToken: encryptCredential(OLD.refresh, KEY), openId: 'open-id-123', externalId: 'open-id-123',
      scope: 'user.info.basic', tokenExpiresAt: '2026-11-04T12:10:00.000Z', refreshExpiresAt: '2027-05-01T00:00:00.000Z', ...over,
    },
  };
}

function deps(channels: ReturnType<typeof channel>[], fetchFn: jest.Mock, over: Partial<{ saved: boolean }> = {}) {
  const logs: string[] = [];
  const store: jest.Mocked<TikTokRefreshStore> = {
    listActive: jest.fn().mockResolvedValue(channels),
    saveRefreshed: jest.fn().mockResolvedValue(over.saved ?? true),
    markReauthRequired: jest.fn().mockResolvedValue(undefined),
  };
  const log = { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };
  return { d: { store, fetchFn: fetchFn as unknown as typeof fetch, key: KEY, clientKey: 'client-key-abc', clientSecret: CLIENT_SECRET, now: () => NOW, log }, store, logs };
}
const noSecretsIn = (logs: string[]) => { for (const l of logs) for (const s of [...Object.values(OLD), ...Object.values(NEWT), CLIENT_SECRET]) expect(l).not.toContain(s); };

describe('runTikTokRefreshCycle', () => {
  it('refreshes a token that is close to expiry, stores BOTH rotated tokens encrypted, and sends the documented refresh request', async () => {
    const f = jest.fn().mockResolvedValue(flat(refreshed));
    const { d, store, logs } = deps([channel()], f);

    const summary = await runTikTokRefreshCycle(d);

    expect(summary).toMatchObject({ checked: 1, refreshed: 1, failed: 0, reauthRequired: 0, raced: 0 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://open.tiktokapis.com/v2/oauth/token/');
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({ client_key: 'client-key-abc', client_secret: CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: OLD.refresh });
    const [id, expected, saved] = store.saveRefreshed.mock.calls[0];
    expect(id).toBe('ch-1');
    expect(decryptCredential(expected, KEY)).toBe(OLD.refresh);                // the compare-and-set guard is the token that was used
    expect(decryptCredential(saved['accessToken'], KEY)).toBe(NEWT.access);
    expect(decryptCredential(saved['refreshToken'], KEY)).toBe(NEWT.refresh);   // the ROTATED refresh token is what gets kept
    expect(saved['accessToken']).toMatch(/^enc:v1:/);
    expect(saved['tokenExpiresAt']).toBe('2026-11-04T14:00:00.000Z');
    expect(saved['openId']).toBe('open-id-123');
    noSecretsIn(logs);
  });

  it('does nothing for a token with plenty of life left, and nothing at all when there are no TikTok channels', async () => {
    const f = jest.fn();
    const { d, store } = deps([channel({ tokenExpiresAt: '2026-11-04T13:30:00.000Z' })], f);
    expect(await runTikTokRefreshCycle(d)).toMatchObject({ checked: 1, skipped: 1, refreshed: 0 });
    expect(f).not.toHaveBeenCalled();
    expect(store.saveRefreshed).not.toHaveBeenCalled();
    expect(await runTikTokRefreshCycle(deps([], f).d)).toMatchObject({ checked: 0 });
  });

  it('invalid_grant (refresh token revoked, rotated away or expired) marks the channel as needing reconnection and keeps the stored tokens untouched', async () => {
    const f = jest.fn().mockResolvedValue(flat({ error: 'invalid_grant', error_description: 'Refresh token is invalid or expired.', log_id: 'LOGR1' }));
    const { d, store, logs } = deps([channel()], f);
    expect(await runTikTokRefreshCycle(d)).toMatchObject({ reauthRequired: 1, refreshed: 0 });
    expect(store.markReauthRequired).toHaveBeenCalledWith('ch-1', { error: 'invalid_grant', at: NOW.toISOString(), logId: 'LOGR1' });
    expect(store.saveRefreshed).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('reconnect required');
    noSecretsIn(logs);
  });

  it('a network failure, a timeout, a 5xx or a malformed body is retried on the next pass: nothing is changed or flagged', async () => {
    for (const f of [
      jest.fn().mockRejectedValue(Object.assign(new Error(`ETIMEDOUT ${CLIENT_SECRET}`), { name: 'TimeoutError' })),
      jest.fn().mockResolvedValue({ status: 503, text: () => Promise.resolve('<html>down</html>') }),
      jest.fn().mockResolvedValue(flat({ error: 'invalid_request', error_description: 'The request parameters are malformed.' })),
    ]) {
      const { d, store, logs } = deps([channel()], f);
      expect(await runTikTokRefreshCycle(d)).toMatchObject({ failed: 1, refreshed: 0, reauthRequired: 0 });
      expect(store.saveRefreshed).not.toHaveBeenCalled();
      expect(store.markReauthRequired).not.toHaveBeenCalled();
      noSecretsIn(logs);
    }
  });

  it('an expired refresh token is not even sent to TikTok: the channel is flagged for reconnection', async () => {
    const f = jest.fn();
    const { d, store } = deps([channel({ refreshExpiresAt: '2026-11-03T00:00:00.000Z' })], f);
    expect(await runTikTokRefreshCycle(d)).toMatchObject({ reauthRequired: 1 });
    expect(f).not.toHaveBeenCalled();
    expect(store.markReauthRequired).toHaveBeenCalledWith('ch-1', { error: 'refresh_token_expired', at: NOW.toISOString() });
  });

  it('lost race: if another runner already stored a rotated token, this one does not overwrite it and says so', async () => {
    const { d, logs } = deps([channel()], jest.fn().mockResolvedValue(flat(refreshed)), { saved: false });
    expect(await runTikTokRefreshCycle(d)).toMatchObject({ raced: 1, refreshed: 0 });
    expect(logs.join('\n')).toContain('lost a race');
    noSecretsIn(logs);
  });

  it('one bad channel does not stop the others, and each tenant\'s tokens stay with their own channel', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce(flat({ error: 'invalid_grant', error_description: 'x', log_id: 'L2' }))
      .mockResolvedValueOnce(flat(refreshed));
    const { d, store } = deps([channel({}, 'ch-bad', 'tenant-A'), channel({}, 'ch-good', 'tenant-B')], f);
    expect(await runTikTokRefreshCycle(d)).toMatchObject({ checked: 2, refreshed: 1, reauthRequired: 1 });
    expect(store.markReauthRequired.mock.calls[0][0]).toBe('ch-bad');
    expect(store.saveRefreshed.mock.calls[0][0]).toBe('ch-good');
  });

  it('a channel with no refresh token is reported and skipped; missing app credentials skip the whole pass with an error', async () => {
    const f = jest.fn();
    const { d } = deps([channel({ refreshToken: '' })], f);
    expect(await runTikTokRefreshCycle(d)).toMatchObject({ skipped: 1 });
    const noCreds = deps([channel()], f);
    expect(await runTikTokRefreshCycle({ ...noCreds.d, clientSecret: undefined })).toMatchObject({ skipped: 1, refreshed: 0 });
    expect(noCreds.logs.join('\n')).toContain('not configured');
    expect(f).not.toHaveBeenCalled();
  });
});
