import { buildFacebookLoginUrl } from './facebook-login-url.util';

const base = { appId: '123', callbackUri: 'https://x.test/api/v1/channels/oauth/facebook/callback', state: 'signed.state' };

function query(url: string) {
  return new URL(url).searchParams;
}

describe('buildFacebookLoginUrl', () => {
  it('uses the classic scope list when no configuration id is set', () => {
    const q = query(buildFacebookLoginUrl({ ...base, provider: 'facebook' }));
    expect(q.get('scope')).toBe('pages_show_list,pages_messaging');
    expect(q.has('config_id')).toBe(false);
  });

  it('uses instagram scopes for the instagram provider', () => {
    expect(query(buildFacebookLoginUrl({ ...base, provider: 'instagram' })).get('scope')).toBe('instagram_basic,pages_show_list');
  });

  it('sends config_id and no scope when a configuration id is set', () => {
    const q = query(buildFacebookLoginUrl({ ...base, provider: 'facebook', configId: ' 987654321 ' }));
    expect(q.get('config_id')).toBe('987654321');
    expect(q.has('scope')).toBe(false);
  });

  it('treats a blank configuration id as unset', () => {
    const q = query(buildFacebookLoginUrl({ ...base, provider: 'facebook', configId: '   ' }));
    expect(q.has('config_id')).toBe(false);
    expect(q.get('scope')).toBe('pages_show_list,pages_messaging');
  });

  it('always requests an authorization code and carries the app, redirect and state', () => {
    const q = query(buildFacebookLoginUrl({ ...base, provider: 'facebook', configId: '1' }));
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe('123');
    expect(q.get('redirect_uri')).toBe(base.callbackUri);
    expect(q.get('state')).toBe('signed.state');
  });
});
