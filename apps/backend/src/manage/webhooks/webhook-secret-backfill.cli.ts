/**
 * One-off data repair: encrypts webhook secrets that were stored as plaintext before secrets were encrypted at
 * rest. Read-only unless --apply is passed. Safe to run more than once. Prints counts only, never a secret.
 *
 * Lives in src/ so it is compiled into the production image, where ts-node does not exist. On a server:
 *
 *   docker exec <backend-container> node dist/manage/webhooks/webhook-secret-backfill.cli.js            # dry run
 *   docker exec <backend-container> node dist/manage/webhooks/webhook-secret-backfill.cli.js --apply    # write
 *
 * On a developer machine: pnpm --filter @whatsapp-platform/backend run webhooks:encrypt-secrets [-- --apply]
 * Needs CREDENTIALS_ENCRYPTION_KEY, the same value the backend runs with.
 */
import { PrismaClient } from '@prisma/client';
import { backfillWebhookSecrets } from './webhook-secret-backfill';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const report = await backfillWebhookSecrets(
    {
      findPlaintext: async () => (await prisma.webhook.findMany({ where: { secret: { not: null } }, select: { id: true, tenantId: true, secret: true } }))
        .map((w) => ({ id: w.id, tenantId: w.tenantId, secret: w.secret as string })),
      replaceSecret: async (id, expected, next) => (await prisma.webhook.updateMany({ where: { id, secret: expected }, data: { secret: next } })).count === 1,
    },
    process.env['CREDENTIALS_ENCRYPTION_KEY'],
    APPLY,
  );
  console.log(APPLY ? 'APPLIED' : 'DRY RUN (nothing written; pass --apply to write)');
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
