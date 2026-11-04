/**
 * The tenant as ANY signed-in member of the workspace may see it. `GET /tenant` is not role-restricted (the dashboard needs the workspace name,
 * ids and webhook verify token), so credentials must never be in the response:
 *  - `accessToken`: the legacy WhatsApp Cloud API token kept on the tenant row (the real, per-number tokens live on whatsapp_numbers);
 *  - `settings.airtableApiKey`: replaced by `settings.airtableApiKeyConfigured` so the form can say a key is saved without revealing it.
 * Everything else is passed through unchanged.
 */
type TenantLike = { accessToken?: unknown; settings?: ({ airtableApiKey?: unknown } & Record<string, unknown>) | null } & Record<string, unknown>;

export function toPublicTenant<T extends TenantLike>(tenant: T): Omit<T, 'accessToken' | 'settings'> & { settings?: Omit<NonNullable<T['settings']>, 'airtableApiKey'> & { airtableApiKeyConfigured: boolean } | null } {
  const { accessToken: _accessToken, settings, ...rest } = tenant;
  void _accessToken;
  if (!settings) return { ...rest, settings } as never;
  const { airtableApiKey, ...publicSettings } = settings;
  return { ...rest, settings: { ...publicSettings, airtableApiKeyConfigured: typeof airtableApiKey === 'string' && airtableApiKey.length > 0 } } as never;
}

export function toPublicTenantSettings<S extends { airtableApiKey?: unknown } & Record<string, unknown>>(settings: S) {
  const { airtableApiKey, ...rest } = settings;
  return { ...rest, airtableApiKeyConfigured: typeof airtableApiKey === 'string' && airtableApiKey.length > 0 };
}
