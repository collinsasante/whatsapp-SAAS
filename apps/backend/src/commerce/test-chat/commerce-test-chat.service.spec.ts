import { BadRequestException, ConflictException } from '@nestjs/common';
import { isSimulatedPhone } from '@whatsapp-platform/shared-utils';
import { SimulationLimitReachedException, SimulationLimitsService, SimulationUnavailableException } from '../../ai-core/simulation/simulation-limits.service';
import { MemorySimulationStore } from '../../ai-core/simulation/simulation-store';
import { CommerceTestChatService } from './commerce-test-chat.service';

const FIXED = () => new Date('2026-10-29T10:00:30.000Z');

function build(env: Record<string, string> = {}, store = new MemorySimulationStore()) {
  const prisma = {
    tenantSettings: { findUnique: jest.fn().mockResolvedValue({ commerceEnabled: true }) },
    contact: { findFirst: jest.fn().mockResolvedValue({ id: 'ct1', name: 'Test Customer (you)' }), create: jest.fn() },
    conversation: { findFirst: jest.fn().mockResolvedValue({ id: 'conv1' }), create: jest.fn() },
    message: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    order: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const commerceAi = { handleMessage: jest.fn().mockResolvedValue({ response: 'We have that.', blocked: false, toolTrace: [] }) };
  const limits = new SimulationLimitsService({ get: (k: string) => env[k] } as never, store, FIXED);
  const service = new CommerceTestChatService(prisma as never, commerceAi as never, limits);
  return { service, prisma, commerceAi, limits, store };
}
const caught = async (p: Promise<unknown>) => { try { await p; return undefined; } catch (e) { return e; } };

describe('CommerceTestChatService under the simulated-AI limits', () => {
  it('a normal message is answered and takes one unit', async () => {
    const { service, commerceAi, limits } = build();
    const r = await service.sendMessage('t1', 'u1', 'do you have labels?');
    expect(r).toMatchObject({ response: 'We have that.', blocked: false });
    expect(commerceAi.handleMessage).toHaveBeenCalledTimes(1);
    expect((await limits.usage('t1', 'u1')).used.requestsToday).toBe(1);
  });

  it('BILLING UNCHANGED: the commerce AI is called exactly as before (no simulation flag, no task-type change), so it is metered as production commerce', async () => {
    const { service, commerceAi } = build();
    await service.sendMessage('t1', 'u1', 'labels?');
    expect(commerceAi.handleMessage.mock.calls[0]).toEqual(['t1', 'conv1', 'ct1', expect.stringMatching(/^\+000TEST/), 'labels?', 'Test Customer (you)']);
  });

  it('its synthetic number is recognised as simulated, so no provider layer would ever message it', async () => {
    const { service, commerceAi } = build();
    await service.sendMessage('t1', '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed', 'labels?');
    expect(isSimulatedPhone(commerceAi.handleMessage.mock.calls[0][3])).toBe(true);
  });

  it('rejects an oversized message before anything is spent or called', async () => {
    const { service, commerceAi, limits } = build({ AI_SIM_MAX_INPUT_CHARS: '10' });
    expect(await caught(service.sendMessage('t1', 'u1', 'x'.repeat(11)))).toBeInstanceOf(BadRequestException);
    expect(commerceAi.handleMessage).not.toHaveBeenCalled();
    expect((await limits.usage('t1', 'u1')).used.requestsToday).toBe(0);
  });

  it('is refused with 429 when the allowance is spent, without calling the AI', async () => {
    const { service, commerceAi } = build({ AI_SIM_DAILY_REQUESTS: '1' });
    await service.sendMessage('t1', 'u1', 'one');
    expect(await caught(service.sendMessage('t1', 'u1', 'two'))).toBeInstanceOf(SimulationLimitReachedException);
    expect(commerceAi.handleMessage).toHaveBeenCalledTimes(1);
  });

  it('shares the tenant allowance with the other test tools but not with another tenant', async () => {
    const store = new MemorySimulationStore();
    const a = build({ AI_SIM_DAILY_REQUESTS: '1' }, store);
    await a.limits.execute({ tenantId: 't1', userId: 'u1', kind: 'test-chat' }, async () => 'spent by the AI Test Chat');
    expect(await caught(a.service.sendMessage('t1', 'u1', 'hi'))).toBeInstanceOf(SimulationLimitReachedException);
    await expect(a.service.sendMessage('t2', 'u1', 'hi')).resolves.toBeDefined();
  });

  it('a retry with the same client id replays the stored result and does not call the commerce AI (or create an order) again', async () => {
    const { service, commerceAi, prisma, limits } = build();
    const first = await service.sendMessage('t1', 'u1', 'order 2 labels', 'client-msg-9001');
    const second = await service.sendMessage('t1', 'u1', 'order 2 labels', 'client-msg-9001');
    expect(commerceAi.handleMessage).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ ...(first as object), replayed: true });
    expect(prisma.message.create).toHaveBeenCalledTimes(2); // the inbound and outbound rows of the first run only
    expect((await limits.usage('t1', 'u1')).used.requestsToday).toBe(1);
  });

  it('after a failure, a retry with the same id is refused and does not run again', async () => {
    const { service, commerceAi } = build();
    commerceAi.handleMessage.mockRejectedValueOnce(new Error('provider down'));
    await caught(service.sendMessage('t1', 'u1', 'hi', 'client-msg-9002'));
    expect(await caught(service.sendMessage('t1', 'u1', 'hi', 'client-msg-9002'))).toBeInstanceOf(ConflictException);
    expect(commerceAi.handleMessage).toHaveBeenCalledTimes(1);
  });

  it('simultaneous sends cannot exceed the allowance', async () => {
    const { service, commerceAi } = build({ AI_SIM_DAILY_REQUESTS: '2', AI_SIM_USER_PER_MINUTE: '60' });
    commerceAi.handleMessage.mockImplementation(() => new Promise((r) => setImmediate(() => r({ response: 'ok', blocked: false, toolTrace: [] }))));
    const out = await Promise.all(Array.from({ length: 10 }, (_v, i) => service.sendMessage('t1', 'u1', `m${i}`).then(() => 'ok', (e) => (e instanceof SimulationLimitReachedException ? 'refused' : 'error'))));
    expect(out.filter((x) => x === 'ok')).toHaveLength(2);
    expect(out).not.toContain('error');
    expect(commerceAi.handleMessage).toHaveBeenCalledTimes(2);
  });

  it('is refused with 503 and calls nothing when the counters are unavailable', async () => {
    const { service, commerceAi } = build({}, { reserve: () => Promise.reject(new Error('down')), read: jest.fn(), claim: jest.fn(), get: jest.fn(), set: jest.fn(), del: jest.fn() } as never);
    expect(await caught(service.sendMessage('t1', 'u1', 'hi'))).toBeInstanceOf(SimulationUnavailableException);
    expect(commerceAi.handleMessage).not.toHaveBeenCalled();
  });

  it('still refuses when commerce is not enabled, without spending', async () => {
    const { service, prisma, limits } = build();
    prisma.tenantSettings.findUnique.mockResolvedValue({ commerceEnabled: false });
    expect(await caught(service.sendMessage('t1', 'u1', 'hi'))).toBeInstanceOf(BadRequestException);
    expect((await limits.usage('t1', 'u1')).used.requestsToday).toBe(0);
  });
});
