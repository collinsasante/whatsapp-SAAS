/* eslint-disable no-console */
import { writeFileSync } from 'fs';
import { formatReport, runValidation } from './staging-validation';

/**
 * Runs the Digital Self staging validation. Needs model credentials on the target, a SYNTHETIC workspace and an admin token for it.
 *   CONFIRM_SYNTHETIC_DATA=yes STAGING_API_URL=https://staging.verzchat.com:8443/api/v1 STAGING_TOKEN=... \
 *   DS_A=<id> DS_B=<id> QUESTION="How much is the red shirt?" MUST_CONTAIN="red shirt,GH₵50" ALLOWED_PRICES="GH₵50" \
 *   MUST_NOT_CONTAIN="discount,free delivery" pnpm digital-self:validate
 * Optional: DS_INSUFFICIENT=<id>, RUNS (default 3), REPORT_FILE=<path> to save the replies and results as JSON.
 */
const list = (v: string | undefined): string[] => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

async function main(): Promise<void> {
  const env = process.env;
  const need = (k: string): string => {
    const v = env[k];
    if (!v) throw new Error(`${k} is required (see the comment at the top of this file)`);
    return v;
  };
  const runs = Number(env['RUNS'] ?? 3);
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('RUNS must be a whole number from 1 to 10');
  const report = await runValidation(
    {
      apiUrl: need('STAGING_API_URL'), token: need('STAGING_TOKEN'), digitalSelfA: need('DS_A'), digitalSelfB: need('DS_B'),
      digitalSelfInsufficient: env['DS_INSUFFICIENT'], question: need('QUESTION'), runs,
      facts: { mustContain: list(env['MUST_CONTAIN']), mustNotContain: list(env['MUST_NOT_CONTAIN']), allowedPrices: list(env['ALLOWED_PRICES']) },
      confirmSyntheticData: env['CONFIRM_SYNTHETIC_DATA'] === 'yes',
      onProgress: (m) => console.log(m),
    },
    (url, init) => fetch(url, init),
  );
  console.log(formatReport(report));
  if (env['REPORT_FILE']) writeFileSync(env['REPORT_FILE'], JSON.stringify({ ok: report.ok, checks: report.checks, replies: report.replies }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Failed');
  process.exit(1);
});
