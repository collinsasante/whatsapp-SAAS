/**
 * Encrypts (or, for rollback, decrypts) every stored credential. DRY RUN unless --apply. Prints counts only, never a value or an id.
 *
 *   node dist/common/crypto/credential-reencryption.cli.js                                       # dry run, encrypt
 *   node dist/common/crypto/credential-reencryption.cli.js --apply --i-have-a-verified-backup    # write
 *   node dist/common/crypto/credential-reencryption.cli.js --decrypt --apply --i-have-a-verified-backup   # rollback
 *
 * Needs DATABASE_URL and CREDENTIALS_ENCRYPTION_KEY (the same value every service runs with). Exit code 0 only if the run completed and, when applying,
 * the verification pass found nothing out of state. Run it AFTER the key has been set on every service that reads credentials (see
 * docs/CREDENTIAL_ENCRYPTION_PLAN.md): otherwise a service without the key would fail to read the ciphertext.
 */
import { PrismaClient } from '@prisma/client';
import { reencryptCredentials } from './credential-reencryption';
import { buildTargets } from './credential-reencryption.targets';

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');
  const mode = process.argv.includes('--decrypt') ? 'decrypt' : 'encrypt';
  if (apply && !process.argv.includes('--i-have-a-verified-backup')) {
    throw new Error('--apply requires --i-have-a-verified-backup (take and restore-check a database dump first).');
  }
  const report = await reencryptCredentials(buildTargets(prisma), process.env['CREDENTIALS_ENCRYPTION_KEY'], { mode, apply });
  console.log(apply ? `APPLIED (${mode})` : `DRY RUN (${mode}; nothing written; pass --apply --i-have-a-verified-backup to write)`);
  console.log(JSON.stringify(report, null, 2));
  if (report.aborted || (report.verification && !report.verification.ok)) process.exitCode = 1;
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
