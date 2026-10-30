/**
 * A channel as the dashboard may see it. Channel.credentials holds tokens (Telegram bot token, TikTok and
 * Instagram access tokens), so it never leaves the server in an API response; `hasCredentials` says whether any
 * are stored. Server code that needs the tokens reads the row itself, never through these responses.
 */
export type PublicChannel<T extends { credentials?: unknown }> = Omit<T, 'credentials'> & { hasCredentials: boolean };

export function toPublicChannel<T extends { credentials?: unknown }>(channel: T): PublicChannel<T> {
  const { credentials, ...rest } = channel;
  const hasCredentials = !!credentials && typeof credentials === 'object' && Object.keys(credentials as object).length > 0;
  return { ...rest, hasCredentials };
}
