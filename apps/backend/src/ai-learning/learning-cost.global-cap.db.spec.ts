import { randomUUID } from 'crypto';
import { AiLearningCostService } from './learning-cost.service';
import { LearningCostConfig } from './learning-cost.config';
import { isolatedDbSuite, makeFixtures, newIsolatedTestClient } from './testing/db-test-env';

// The global cap is a total over EVERY workspace in the database, so this spec needs a database no other suite writes to.
// Run with AI_LEARNING_TEST_ISOLATED_DATABASE_URL (see testing/db-test-env.ts).
const prisma = newIsolatedTestClient();
const fx = prisma ? makeFixtures(prisma) : (undefined as unknown as ReturnType<typeof makeFixtures>);
const EST = 2_000;
const RESERVATION = 1_200n;
const BIG: LearningCostConfig = { workspaceMonthlyBudgetMicros: 1_000_000_000n, globalMonthlyBudgetMicros: 1_000_000_000n, maxReservationMicros: 50_000n };

isolatedDbSuite('AiLearningCostService global cap (isolated database)', () => {
  const service = (config: Partial<LearningCostConfig> = {}) => new AiLearningCostService(prisma as never, { ...BIG, ...config });
  afterAll(async () => { await fx.cleanup(); await prisma.$disconnect(); });
  async function optedIn() {
    const tenantId = await fx.tenant();
    await prisma.aiLearningSettings.create({ data: { tenantId, learningEnabled: true } });
    return tenantId;
  }

  it('PROOF: 24 concurrent reservations across 6 workspaces never exceed the GLOBAL cap', async () => {
    const svc = service({ globalMonthlyBudgetMicros: RESERVATION * 5n });
    const tenants = await Promise.all(Array.from({ length: 6 }, () => optedIn()));

    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => svc.reserve({ tenantId: tenants[i % 6]!, aiExecutionId: randomUUID(), estimatedInputTokens: EST })));

    expect(results.filter((r) => r.kind === 'reserved')).toHaveLength(5);
    expect(results.filter((r) => r.kind === 'skipped' && r.reason === 'global_cap')).toHaveLength(19);
    expect((await svc.summary(tenants[0]!)).globalMicros).toBe(RESERVATION * 5n);
  });

  it('a global denial is recorded as a SKIPPED row that costs nothing', async () => {
    const tenantId = await optedIn();
    const before = (await service().summary(tenantId)).globalMicros;
    const svc = service({ globalMonthlyBudgetMicros: before }); // exactly full
    const execution = randomUUID();

    await expect(svc.reserve({ tenantId, aiExecutionId: execution, estimatedInputTokens: EST })).resolves.toMatchObject({ kind: 'skipped', reason: 'global_cap' });

    expect(await prisma.aiLearningUsage.findMany({ where: { aiExecutionId: execution } })).toMatchObject([{ state: 'SKIPPED', skipReason: 'global_cap', reservedMicros: 0n }]);
    expect((await svc.summary(tenantId)).globalMicros).toBe(before);
  });
});
