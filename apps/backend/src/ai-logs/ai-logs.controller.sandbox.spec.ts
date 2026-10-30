import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SimulationLimitReachedException, SimulationLimitsService } from '../ai-core/simulation/simulation-limits.service';
import { MemorySimulationStore } from '../ai-core/simulation/simulation-store';
import { AiLogsController } from './ai-logs.controller';

const FIXED = () => new Date('2026-10-29T10:00:30.000Z');
const user = { tenantId: 't1', sub: 'u1' } as never;

function build(env: Record<string, string> = {}) {
  const aiResponder = {
    isAiUsable: jest.fn().mockResolvedValue(true),
    generateSuggestion: jest.fn().mockResolvedValue({ response: 'Hello!', confidence: 80, blocked: false }),
  };
  const limits = new SimulationLimitsService({ get: (k: string) => env[k] } as never, new MemorySimulationStore(), FIXED);
  const controller = new AiLogsController({} as never, aiResponder as never, limits);
  return { controller, aiResponder, limits };
}
const caught = async (p: Promise<unknown>) => { try { await p; return undefined; } catch (e) { return e; } };

describe('AI sandbox (POST /ai-logs/test) under the simulated-AI limits', () => {
  it('answers a normal message and takes one unit', async () => {
    const { controller, aiResponder, limits } = build();
    const r = await controller.test(user, { message: 'hello' });
    expect(r).toMatchObject({ response: 'Hello!', confidence: 80, injectionBlocked: false });
    expect(aiResponder.generateSuggestion).toHaveBeenCalledWith('t1', 'sandbox-test', 'hello');
    expect((await limits.usage('t1', 'u1')).used.requestsToday).toBe(1);
  });

  it('rejects an oversized message before the AI is called', async () => {
    const { controller, aiResponder } = build({ AI_SIM_MAX_INPUT_CHARS: '10' });
    expect(await caught(controller.test(user, { message: 'x'.repeat(11) }))).toBeInstanceOf(BadRequestException);
    expect(aiResponder.generateSuggestion).not.toHaveBeenCalled();
  });

  it('is refused with 429 once the tenant allowance is spent', async () => {
    const { controller, aiResponder } = build({ AI_SIM_DAILY_REQUESTS: '1', AI_SIM_USER_PER_MINUTE: '60' });
    await controller.test(user, { message: 'one' });
    expect(await caught(controller.test(user, { message: 'two' }))).toBeInstanceOf(SimulationLimitReachedException);
    expect(aiResponder.generateSuggestion).toHaveBeenCalledTimes(1);
  });

  it('still refuses first when AI is not usable, spending nothing', async () => {
    const { controller, aiResponder, limits } = build();
    aiResponder.isAiUsable.mockResolvedValue(false);
    expect(await caught(controller.test(user, { message: 'hi' }))).toBeInstanceOf(ForbiddenException);
    expect((await limits.usage('t1', 'u1')).used.requestsToday).toBe(0);
  });

  it('simultaneous requests cannot exceed the allowance', async () => {
    const { controller, aiResponder } = build({ AI_SIM_DAILY_REQUESTS: '2', AI_SIM_USER_PER_MINUTE: '60' });
    aiResponder.generateSuggestion.mockImplementation(() => new Promise((r) => setImmediate(() => r({ response: 'ok', confidence: 1, blocked: false }))));
    const out = await Promise.all(Array.from({ length: 8 }, () => controller.test(user, { message: 'hi' }).then(() => 'ok', () => 'refused')));
    expect(out.filter((x) => x === 'ok')).toHaveLength(2);
    expect(aiResponder.generateSuggestion).toHaveBeenCalledTimes(2);
  });
});
