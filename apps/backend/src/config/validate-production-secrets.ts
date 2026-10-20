// Secrets that must never reach production with their insecure, source-visible
// defaults (see apps/backend/src/config/app.config.ts) -- if either is missing
// or unchanged, the server would silently sign/verify every access, refresh,
// and OAuth-state token (channels.controller.ts's oauthStateSecret falls back
// to JWT_SECRET) with a value anyone can read in this repo.
const REQUIRED_PRODUCTION_SECRETS: Record<string, string> = {
  JWT_SECRET: 'changeme',
  JWT_REFRESH_SECRET: 'changeme-refresh',
};

export function assertProductionSecretsConfigured(): void {
  if (process.env['NODE_ENV'] !== 'production') return;
  const problems = Object.entries(REQUIRED_PRODUCTION_SECRETS)
    .filter(([envVar, insecureDefault]) => {
      const value = process.env[envVar];
      return !value || value === insecureDefault;
    })
    .map(([envVar]) => envVar);
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with insecure/missing secret(s): ${problems.join(', ')}. ` +
      'Set real values for these environment variables before deploying.',
    );
  }
}
