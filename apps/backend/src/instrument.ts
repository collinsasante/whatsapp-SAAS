const dsn = process.env.SENTRY_DSN;

if (dsn) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/nestjs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { nodeProfilingIntegration } = require('@sentry/profiling-node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'production',
      integrations: [nodeProfilingIntegration()],
      tracesSampleRate: 0.1,
      profilesSampleRate: 0.1,
    });
    console.log('[Sentry] Initialised (backend)');
  } catch {
    console.warn('[Sentry] Package not found — skipping initialisation. Install @sentry/nestjs to enable.');
  }
}
