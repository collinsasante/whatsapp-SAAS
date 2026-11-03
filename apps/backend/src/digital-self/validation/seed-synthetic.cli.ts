/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { AMA, KOFI } from './synthetic-personas';
import { cleanupSynthetic, optInSyntheticWorkspace, seedSynthetic } from './seed-synthetic';

/**
 * Seeds (or removes) INVENTED agent history in a SYNTHETIC workspace, for the staging validation.
 *   CONFIRM_SYNTHETIC_DATA=yes DATABASE_URL=... SEED_TENANT_ID=... SEED_AGENT_A_ID=... SEED_AGENT_B_ID=... pnpm digital-self:seed-synthetic
 *   ... SEED_TENANT_ID=... pnpm digital-self:seed-synthetic --cleanup
 * The workspace must have opted in to AI learning (it is OFF by default). Add --opt-in to do that explicitly first, as an administrator of
 * the SYNTHETIC workspace: SEED_ADMIN_ID=<admin user id> ... pnpm digital-self:seed-synthetic --opt-in   (needs AI_LEARNING_OPT_IN_OPEN=true)
 * Optional: SEED_REPLIES (default 36 per agent; READY needs 30). Agent A gets the warm "Ama" persona, agent B the terse "Kofi" one.
 */
async function main(): Promise<void> {
  const env = process.env;
  if (env['CONFIRM_SYNTHETIC_DATA'] !== 'yes') throw new Error('Set CONFIRM_SYNTHETIC_DATA=yes to confirm the target workspace holds synthetic data only.');
  const tenantId = env['SEED_TENANT_ID'];
  if (!tenantId) throw new Error('SEED_TENANT_ID is required');
  const prisma = new PrismaClient();
  try {
    if (process.argv.includes('--cleanup')) {
      const r = await cleanupSynthetic(prisma, tenantId);
      console.log(`Removed ${r.conversations} synthetic conversation(s); ${r.evidenceRemoved} learned reply(ies) removed from profiles.`);
      return;
    }
    if (process.argv.includes('--opt-in')) {
      const adminId = env['SEED_ADMIN_ID'];
      if (!adminId) throw new Error('SEED_ADMIN_ID (an administrator of the synthetic workspace) is required with --opt-in');
      const view = await optInSyntheticWorkspace(prisma, tenantId, adminId);
      console.log(`Workspace opted in explicitly; acknowledged notice ${view.acknowledgement.version}.`);
    }
    const [a, b] = [env['SEED_AGENT_A_ID'], env['SEED_AGENT_B_ID']];
    if (!a || !b) throw new Error('SEED_AGENT_A_ID and SEED_AGENT_B_ID are required');
    const replies = Number(env['SEED_REPLIES'] ?? 36);
    if (!Number.isInteger(replies) || replies < 1 || replies > 500) throw new Error('SEED_REPLIES must be a whole number from 1 to 500');
    const r = await seedSynthetic(prisma, tenantId, [{ userId: a, persona: AMA }, { userId: b, persona: KOFI }], replies);
    console.log(`Created ${r.created} synthetic replies; the learner accepted ${r.learned}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Failed');
  process.exit(1);
});
