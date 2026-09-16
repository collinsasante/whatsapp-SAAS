/**
 * One-off data-repair script for the 2026-09-16 incident: TenantService's
 * legacy quick-save path (fixed in this same change, see tenant.service.ts)
 * used to only sync a WhatsApp credential update to WhatsAppNumber when
 * phoneNumberId, wabaId, and accessToken were ALL sent together. A real
 * caller re-pasting just a fresh access token silently updated
 * Tenant.accessToken while leaving the linked default WhatsAppNumber's
 * accessToken stale -- invisible until WhatsAppNumber became the thing
 * actually used to send (Phase 3), at which point it broke real sends with
 * a Meta authentication error.
 *
 * Tenant.accessToken is the proven-live value (it's what every send used,
 * successfully, until now), so for each tenant's default WhatsAppNumber
 * whose phoneNumberId still matches the tenant's, this copies
 * Tenant.{wabaId,accessToken} onto that row wherever they differ. Never
 * touches a row whose phoneNumberId doesn't match the tenant's -- that
 * would be a different, unrelated problem, not something to silently paper
 * over here.
 *
 * Defaults to a dry run (prints what it would change, writes nothing).
 * Pass --apply to actually write:
 *
 *   pnpm --filter @whatsapp-platform/backend run whatsapp:resync-tokens
 *   pnpm --filter @whatsapp-platform/backend run whatsapp:resync-tokens -- --apply
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  if (process.env['CREDENTIALS_ENCRYPTION_KEY']) {
    // This script copies Tenant.accessToken (always plaintext by design)
    // directly onto WhatsAppNumber.accessToken. If encryption is active,
    // WhatsAppNumber.accessToken is expected to be ciphertext -- writing
    // plaintext into it would break every read site that decrypts. Safer to
    // refuse than to guess.
    console.error('CREDENTIALS_ENCRYPTION_KEY is set -- refusing to run. This script assumes plaintext WhatsAppNumber.accessToken; encrypt the value first if you need this to run with encryption active.');
    process.exit(1);
  }

  const defaults = await prisma.whatsAppNumber.findMany({
    where: { isDefault: true },
    include: { tenant: true },
  });

  let mismatched = 0;
  let fixed = 0;
  let skippedPhoneMismatch = 0;

  for (const num of defaults) {
    const tenant = num.tenant;
    if (!tenant.phoneNumberId || !tenant.wabaId || !tenant.accessToken) continue;

    if (tenant.phoneNumberId !== num.phoneNumberId) {
      console.log(`SKIP tenant=${tenant.id} (${tenant.name}): Tenant.phoneNumberId (${tenant.phoneNumberId}) != WhatsAppNumber.phoneNumberId (${num.phoneNumberId}) -- different identity, not touching`);
      skippedPhoneMismatch++;
      continue;
    }

    const tokenMatches = tenant.accessToken === num.accessToken;
    const wabaMatches = tenant.wabaId === num.wabaId;
    if (tokenMatches && wabaMatches) continue;

    mismatched++;
    const diffs = [!tokenMatches && 'accessToken', !wabaMatches && 'wabaId'].filter(Boolean).join(', ');
    console.log(`${APPLY ? 'FIXING' : 'WOULD FIX'} tenant=${tenant.id} (${tenant.name}) whatsappNumber=${num.id}: ${diffs} differs from Tenant`);

    if (APPLY) {
      await prisma.whatsAppNumber.update({
        where: { id: num.id },
        data: { accessToken: tenant.accessToken, wabaId: tenant.wabaId },
      });
      fixed++;
    }
  }

  console.log(`\n${defaults.length} default WhatsApp numbers checked, ${mismatched} mismatched, ${skippedPhoneMismatch} skipped (phoneNumberId differs).`);
  console.log(APPLY ? `${fixed} row(s) fixed.` : `Dry run -- 0 rows written. Re-run with --apply to write.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
