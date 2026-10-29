import { ConflictException } from '@nestjs/common';
import { SimulationLimitReachedException, SimulationLimitsService, SimulationUnavailableException } from '../../ai-core/simulation/simulation-limits.service';
import { MemorySimulationStore } from '../../ai-core/simulation/simulation-store';
import { EvaluationRunService } from './evaluation-run.service';

const FIXED = () => new Date('2026-10-29T10:00:30.000Z');

function build(env: Record<string, string> = {}, store = new MemorySimulationStore()) {
  const prisma = {
    evaluationRun: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: { data: object }) => ({ id: `run-${Math.random().toString(36).slice(2, 8)}`, ...data })),
    },
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const limits = new SimulationLimitsService({ get: (k: string) => env[k] } as never, store, FIXED);
  const service = new EvaluationRunService(prisma as never, queue as never, limits);
  return { service, prisma, queue, limits };
}
const caught = async (p: Promise<unknown>) => { try { await p; return undefined; } catch (e) { return e; } };

describe('EvaluationRunService.createRun under the simulated-AI limits (a run is ~15-20 scripted conversations)', () => {
  it('creates and queues a run, and takes one unit of the daily run budget', async () => {
    const { service, queue, limits } = build();
    const run = await service.createRun('t1', 'u1');
    expect(run).toMatchObject({ tenantId: 't1', status: 'QUEUED' });
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect((await limits.usage('t1', 'u1')).used.evalRunsToday).toBe(1);
  });

  it('refuses a run after the daily run budget, creating and queueing nothing', async () => {
    const { service, prisma, queue } = build({ AI_SIM_DAILY_EVAL_RUNS: '2' });
    await service.createRun('t1', 'u1');
    await service.createRun('t1', 'u1');
    const err = (await caught(service.createRun('t1', 'u1'))) as SimulationLimitReachedException;
    expect(err).toBeInstanceOf(SimulationLimitReachedException);
    expect(err.getResponse()).toMatchObject({ scope: 'eval_runs_daily', limit: 2 });
    expect(prisma.evaluationRun.create).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('refuses while a run is already queued or running, and spends nothing', async () => {
    const { service, prisma, queue, limits } = build();
    prisma.evaluationRun.findFirst.mockResolvedValue({ id: 'active-run' });
    const err = (await caught(service.createRun('t1', 'u1'))) as ConflictException;
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'EVALUATION_RUN_IN_PROGRESS' });
    expect(prisma.evaluationRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 't1', status: { in: ['QUEUED', 'RUNNING'] } } }));
    expect(queue.add).not.toHaveBeenCalled();
    expect((await limits.usage('t1', 'u1')).used.evalRunsToday).toBe(0);
  });

  it('simultaneous requests cannot take more runs than the budget', async () => {
    const { service, queue } = build({ AI_SIM_DAILY_EVAL_RUNS: '3' });
    const out = await Promise.all(Array.from({ length: 20 }, () => service.createRun('t1', 'u1').then(() => 'ok', (e) => (e instanceof SimulationLimitReachedException ? 'refused' : 'error'))));
    expect(out.filter((x) => x === 'ok')).toHaveLength(3);
    expect(out).not.toContain('error');
    expect(queue.add).toHaveBeenCalledTimes(3);
  });

  it('the budget is per tenant', async () => {
    const store = new MemorySimulationStore();
    const { service } = build({ AI_SIM_DAILY_EVAL_RUNS: '1' }, store);
    await service.createRun('t1', 'u1');
    expect(await caught(service.createRun('t1', 'u1'))).toBeInstanceOf(SimulationLimitReachedException);
    await expect(service.createRun('t2', 'u1')).resolves.toBeDefined();
  });

  it('is refused with 503, and creates nothing, when the counters are unavailable', async () => {
    const { service, queue } = build({}, { reserve: () => Promise.reject(new Error('down')) } as never);
    expect(await caught(service.createRun('t1', 'u1'))).toBeInstanceOf(SimulationUnavailableException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('a budget of 0 switches evaluation runs off for the tenant', async () => {
    const { service } = build({ AI_SIM_DAILY_EVAL_RUNS: '0' });
    expect(await caught(service.createRun('t1', 'u1'))).toBeInstanceOf(SimulationLimitReachedException);
  });
});
