const FACEBOOK_DIALOG_URL = 'https://www.facebook.com/v19.0/dialog/oauth';

// Permissions for the classic Facebook Login flow. pages_messaging is required for the Messenger Send API and webhook
// subscription; pages_read_engagement is deliberately absent because Meta rejects it as an invalid scope for apps
// created through the Business Messaging use case flow.
const CLASSIC_SCOPES: Record<'facebook' | 'instagram', string> = {
  facebook: 'pages_show_list,pages_messaging',
  instagram: 'instagram_basic,pages_show_list',
};

export interface FacebookLoginUrlInput {
  provider: 'facebook' | 'instagram';
  appId: string;
  callbackUri: string;
  state: string;
  /**
   * Facebook Login for Business apps define permissions in a Configuration (App Dashboard > Facebook Login for Business >
   * Configurations) and pass its ID as config_id instead of scope. Leave unset for apps that use classic Facebook Login.
   */
  configId?: string;
}

export function buildFacebookLoginUrl(input: FacebookLoginUrlInput): string {
  const params = new URLSearchParams({
    client_id: input.appId,
    redirect_uri: input.callbackUri,
    response_type: 'code',
    state: input.state,
  });
  const configId = input.configId?.trim();
  if (configId) params.set('config_id', configId);
  else params.set('scope', CLASSIC_SCOPES[input.provider]);
  return `${FACEBOOK_DIALOG_URL}?${params.toString()}`;
}
