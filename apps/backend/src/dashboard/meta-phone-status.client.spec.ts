import axios from 'axios';
import { MetaPhoneStatusClient } from './meta-phone-status.client';

jest.mock('axios');
const get = axios.get as jest.Mock;

describe('MetaPhoneStatusClient', () => {
  const client = new MetaPhoneStatusClient();
  afterEach(() => jest.resetAllMocks());

  it('returns what Meta reports and sends the token in a header, never the URL', async () => {
    get.mockResolvedValue({ data: { quality_rating: 'GREEN', messaging_limit_tier: 'TIER_1K' } });
    const r = await client.fetch('123', 'tok');
    expect(r).toEqual({ ok: true, data: { quality_rating: 'GREEN', messaging_limit_tier: 'TIER_1K' } });
    const [url, opts] = get.mock.calls[0];
    expect(url).not.toContain('tok');
    expect(opts.headers.Authorization).toBe('Bearer tok');
    expect(opts.timeout).toBeLessThanOrEqual(10_000);
  });

  it('says the token is invalid for Meta error 190', async () => {
    get.mockRejectedValue({ response: { data: { error: { code: 190, message: 'Error validating access token: secret-details' } } } });
    const r = await client.fetch('123', 'tok');
    expect(r).toMatchObject({ ok: false, kind: 'TOKEN_INVALID' });
    expect(JSON.stringify(r)).not.toContain('secret-details');
  });

  it('reports other Meta errors without echoing Meta\'s text', async () => {
    get.mockRejectedValue({ response: { data: { error: { code: 100, message: 'internal detail' } } } });
    const r = await client.fetch('123', 'tok');
    expect(r).toMatchObject({ ok: false, kind: 'META_ERROR' });
    expect(JSON.stringify(r)).not.toContain('internal detail');
  });

  it('reports a timeout or network failure as unreachable', async () => {
    get.mockRejectedValue({ code: 'ECONNABORTED' });
    expect(await client.fetch('123', 'tok')).toMatchObject({ ok: false, kind: 'UNREACHABLE' });
  });
});
