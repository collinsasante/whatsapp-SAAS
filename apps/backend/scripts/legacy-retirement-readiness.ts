/**
 * Readiness report for moving workspaces from the legacy responder to VerzAI v2 (the new Digital Self).
 *
 * READ-ONLY by default: prints, per workspace, which route it uses today, whether anything blocks the move, and warnings.
 * It never switches a workspace over (that is the `verz_ai_v2` feature-flag rollout, a deliberate platform-admin action) and
 * never overwrites configuration. With --apply it performs only the one safe action the assessment proposes: filling an
 * agent personality that is EMPTY from the workspace's own personality.
 *
 *   pnpm --filter @whatsapp-platform/backend run ai:legacy-readiness
 *   pnpm --filter @whatsapp-platform/backend run ai:legacy-readiness -- --tenant <tenantId>
 *   pnpm --filter @whatsapp-platform/backend run ai:legacy-readiness -- --apply
 */
import { PrismaClient } from '@prisma/client';
import { FeatureFlagsService } from '../src/feature-flags/feature-flags.service';
import { assessLegacyRetirement } from '../src/ai-core/migration/legacy-retirement.util';
import { containsRetiredScript } from '../src/ai-core/prompts/retired-wording';
import { RESPONDER_SYSTEM_TEMPLATE_KEY, RESPONDER_SYSTEM_VERSION } from '../src/ai-core/prompts/seed/responder-system.v1';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const tenantArg = process.argv.indexOf('--tenant') >= 0 ? process.argv[process.argv.indexOf('--tenant') + 1] : undefined;

async function main() {
  const flags = new FeatureFlagsService(prisma as never);
  const template = await prisma.aiPromptTemplate.findUnique({ where: { key: RESPONDER_SYSTEM_TEMPLATE_KEY }, include: { versions: { where: { status: 'ACTIVE' }, take: 1 } } });
  const active = template?.versions[0];
  const activePrompt = active ? { version: active.version, scriptsFixedReply: containsRetiredScript(active.body) } : null;

  const tenants = await prisma.tenantSettings.findMany({
    where: tenantArg ? { tenantId: tenantArg } : undefined,
    select: { tenantId: true, commerceEnabled: true, aiEnabled: true, aiMode: true, aiPersonality: true },
    orderBy: { tenantId: 'asc' },
  });

  const summary = { total: 0, commerce: 0, v2: 0, legacyReady: 0, legacyBlocked: 0, appliedActions: 0 };
  for (const t of tenants) {
    const [agent, knowledgeArticles, v2FlagEnabled] = await Promise.all([
      prisma.aiAgent.findFirst({ where: { tenantId: t.tenantId, isDefault: true }, select: { id: true, status: true, personality: true, modelKey: true, maxResponseTokens: true } }),
      prisma.knowledgeBaseArticle.count({ where: { tenantId: t.tenantId, isActive: true } }),
      flags.isEnabled('verz_ai_v2', t.tenantId),
    ]);
    const a = assessLegacyRetirement({
      tenantId: t.tenantId, commerceEnabled: t.commerceEnabled, v2FlagEnabled, aiEnabled: t.aiEnabled, aiMode: t.aiMode,
      settingsPersonality: t.aiPersonality, agent, activePrompt, currentPromptVersion: RESPONDER_SYSTEM_VERSION, knowledgeArticles,
    });

    summary.total += 1;
    if (a.route === 'commerce') summary.commerce += 1;
    else if (a.route === 'v2') summary.v2 += 1;
    else if (a.ready) summary.legacyReady += 1;
    else summary.legacyBlocked += 1;

    console.log(JSON.stringify({ tenantId: a.tenantId, route: a.route, ready: a.ready, blockers: a.blockers, warnings: a.warnings, safeActions: a.safeActions.map((s) => s.type) }));

    if (APPLY && agent) {
      for (const action of a.safeActions) {
        // updateMany with the empty-personality condition makes the write itself refuse to overwrite anything set in the meantime.
        const res = await prisma.aiAgent.updateMany({ where: { id: agent.id, tenantId: t.tenantId, OR: [{ personality: null }, { personality: '' }] }, data: { personality: action.agentPersonality } });
        summary.appliedActions += res.count;
      }
    }
  }
  console.log(JSON.stringify({ summary, mode: APPLY ? 'apply (safe actions only)' : 'dry run (nothing written)', activePrompt }));
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
