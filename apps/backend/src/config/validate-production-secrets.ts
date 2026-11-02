// Secrets that must never reach production with their insecure, source-visible
// defaults (see apps/backend/src/config/app.config.ts) -- if either is missing
// or unchanged, the server would silently sign/verify every access, refresh,
// and OAuth-state token (channels.controller.ts's oauthStateSecret falls back
// to JWT_SECRET) with a value anyone can read in this repo.
const REQUIRED_PRODUCTION_SECRETS: Record<string, string> = {
  JWT_SECRET: 'changeme',
  JWT_REFRESH_SECRET: 'changeme-refresh',
};

// Secrets with no insecure default that production cannot run safely without: the internal service-to-service secrets (every
// internal endpoint refuses callers without them) and the Meta app secret (inbound WhatsApp webhooks are refused without it).
const REQUIRED_PRODUCTION_VARS = ['INTERNAL_SECRET', 'WHATSAPP_WEB_INTERNAL_API_KEY', 'WHATSAPP_APP_SECRET'] as const;

// Optional integrations. The server starts without them and the feature reports itself unavailable, so these are logged, not fatal.
const OPTIONAL_INTEGRATION_VARS: Record<string, string> = {
  STRIPE_SECRET_KEY: 'card payments (Stripe) are unavailable',
  STRIPE_WEBHOOK_SECRET: 'Stripe webhooks are refused',
  PAYSTACK_SECRET_KEY: 'Paystack payments and Commerce webhooks are unavailable',
  FACEBOOK_APP_SECRET: 'Messenger and Instagram webhooks are refused',
  RESEND_WEBHOOK_SECRET: 'inbound email webhooks are refused',
};

/** Names (never values) of optional integrations that are not configured, with what that disables. */
export function describeMissingOptionalConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(OPTIONAL_INTEGRATION_VARS)
    .filter(([name]) => !env[name])
    .map(([name, effect]) => `${name} is not set: ${effect}`);
}

export function assertProductionSecretsConfigured(): void {
  if (process.env['NODE_ENV'] !== 'production') return;
  const problems = Object.entries(REQUIRED_PRODUCTION_SECRETS)
    .filter(([envVar, insecureDefault]) => {
      const value = process.env[envVar];
      return !value || value === insecureDefault;
    })
    .map(([envVar]) => envVar);
  for (const name of REQUIRED_PRODUCTION_VARS) {
    if (!process.env[name]) problems.push(name);
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with insecure or missing secret(s): ${problems.join(', ')}. ` +
      'Set real values for these environment variables before deploying.',
    );
  }
}
