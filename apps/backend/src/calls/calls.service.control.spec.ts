import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CallsService } from './calls.service';

function build(call: Record<string, unknown> | null) {
  const prisma = {
    callLog: {
      findFirst: jest.fn().mockResolvedValue(call),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...call, ...data })),
      create: jest.fn().mockResolvedValue({ id: 'new' }),
    },
    contact: { findFirst: jest.fn().mockResolvedValue(null) },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u2', name: 'B' }) },
    activityLog: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const svc = Object.create(CallsService.prototype) as Record<string, unknown>;
  Object.assign(svc, {
    prisma,
    logger: { log: jest.fn(), warn: jest.fn() },
    realtime: { emitCallEvent: jest.fn() },
    emit: jest.fn(),
    logCallActivity: jest.fn().mockResolvedValue(undefined),
  });
  return { svc: svc as unknown as CallsService, prisma };
}
const ringing = { id: 'call1', tenantId: 't1', userId: 'owner', status: 'ONGOING', metadata: {} };

describe('CallsService -- control authorization', () => {
  it('stops another agent from muting, holding, updating or transferring someone else\'s call', async () => {
    const { svc, prisma } = build(ringing);
    const other = { userId: 'intruder', role: 'AGENT' };
    await expect(svc.mute('t1', 'call1', { muted: true } as never, other)).rejects.toThrow(ForbiddenException);
    await expect(svc.hold('t1', 'call1', { held: true } as never, other)).rejects.toThrow(ForbiddenException);
    await expect(svc.update('t1', 'call1', { status: 'ENDED' } as never, other)).rejects.toThrow(ForbiddenException);
    await expect(svc.transfer('t1', 'call1', 'intruder', { toUserId: 'u2' } as never, 'AGENT')).rejects.toThrow(ForbiddenException);
    expect(prisma.callLog.update).not.toHaveBeenCalled();
  });

  it('allows the call owner, an admin, and any agent for an unclaimed call', async () => {
    for (const [call, actor] of [
      [ringing, { userId: 'owner', role: 'AGENT' }],
      [ringing, { userId: 'boss', role: 'ADMIN' }],
      [{ ...ringing, userId: null }, { userId: 'anyone', role: 'AGENT' }],
    ] as const) {
      const { svc } = build(call as never);
      await expect(svc.mute('t1', 'call1', { muted: true } as never, actor)).resolves.toBeDefined();
    }
  });

  it('cannot reach a call in another tenant', async () => {
    const { svc, prisma } = build(null);
    await expect(svc.mute('t1', 'call-of-t2', { muted: true } as never, { userId: 'u', role: 'ADMIN' })).rejects.toThrow('Call not found');
    expect(prisma.callLog.findFirst.mock.calls[0][0].where).toEqual({ id: 'call-of-t2', tenantId: 't1' });
  });
});

describe('CallsService.update -- finished calls stay finished', () => {
  it('ignores a late status change on an ended call but still saves notes', async () => {
    const { svc, prisma } = build({ ...ringing, status: 'ENDED' });
    await svc.update('t1', 'call1', { status: 'ONGOING', notes: 'follow up' } as never, { userId: 'owner', role: 'AGENT' });
    const data = prisma.callLog.update.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
    expect(data.notes).toBe('follow up');
  });
  it('still applies a normal transition on a live call', async () => {
    const { svc, prisma } = build(ringing);
    await svc.update('t1', 'call1', { status: 'ENDED' } as never, { userId: 'owner', role: 'AGENT' });
    expect(prisma.callLog.update.mock.calls[0][0].data.status).toBe('ENDED');
  });
});

describe('CallsService.create -- contact tenancy', () => {
  it('rejects a contactId that does not belong to the caller tenant', async () => {
    const { svc, prisma } = build(null);
    await expect(svc.create('t1', 'u1', { contactId: 'foreign', direction: 'OUTBOUND', status: 'INITIATED' } as never)).rejects.toThrow(BadRequestException);
    expect(prisma.contact.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', tenantId: 't1' }, select: { id: true } });
    expect(prisma.callLog.create).not.toHaveBeenCalled();
  });
});

describe('CallsService.expireStaleCalls', () => {
  const NOW = Date.parse('2026-10-14T12:00:00Z');
  function buildSweep(stale: Array<{ id: string; tenantId: string; status: string }>, updateCount = 1) {
    const { svc, prisma } = build(null);
    const callLog = prisma.callLog as unknown as Record<string, jest.Mock>;
    callLog['findMany'] = jest.fn().mockResolvedValue(stale);
    callLog['updateMany'] = jest.fn().mockResolvedValue({ count: updateCount });
    callLog['findFirst'] = jest.fn().mockResolvedValue({ id: 'x' });
    return { svc, prisma: { callLog } as { callLog: { updateMany: jest.Mock; findMany: jest.Mock } } };
  }

  it('marks stuck ringing calls UNANSWERED and stuck ongoing calls ENDED, with a timeout reason', async () => {
    const { svc, prisma } = buildSweep([{ id: 'a', tenantId: 't1', status: 'RINGING' }, { id: 'b', tenantId: 't2', status: 'ONGOING' }]);
    expect(await svc.expireStaleCalls(NOW)).toBe(2);
    const datas = prisma.callLog.updateMany.mock.calls.map((c) => c[0].data);
    expect(datas[0]).toMatchObject({ status: 'UNANSWERED', endReason: 'timeout' });
    expect(datas[1]).toMatchObject({ status: 'ENDED', endReason: 'timeout' });
  });

  it('only closes a call that is still in the state it was read in (a call that just progressed is left alone)', async () => {
    const { svc, prisma } = buildSweep([{ id: 'a', tenantId: 't1', status: 'RINGING' }], 0);
    expect(await svc.expireStaleCalls(NOW)).toBe(0);
    expect(prisma.callLog.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'a', status: 'RINGING' });
  });

  it('looks for ringing calls older than 2 minutes and ongoing calls older than 6 hours', async () => {
    const { svc, prisma } = buildSweep([]);
    await svc.expireStaleCalls(NOW);
    const or = prisma.callLog.findMany.mock.calls[0][0].where.OR;
    expect(or[0].updatedAt.lt.getTime()).toBe(NOW - 2 * 60 * 1000);
    expect(or[1].updatedAt.lt.getTime()).toBe(NOW - 6 * 60 * 60 * 1000);
  });
});

describe('CallsService.initiateCall -- duplicate and tenancy guards', () => {
  it('refuses a second call to a number that is already ringing/in progress, without calling WhatsApp', async () => {
    const { svc, prisma } = build(null);
    prisma.callLog.findFirst = jest.fn().mockResolvedValue({ id: 'live' });
    const initiate = jest.fn();
    (svc as unknown as Record<string, unknown>)['whatsapp'] = { initiateWhatsAppCall: initiate };
    await expect(svc.initiateCall('t1', 'u1', { phone: '+233555000111' } as never)).rejects.toThrow('already in progress');
    expect(initiate).not.toHaveBeenCalled();
  });

  it('rejects a contactId from another tenant before placing the call', async () => {
    const { svc, prisma } = build(null);
    prisma.callLog.findFirst = jest.fn().mockResolvedValue(null);
    const initiate = jest.fn();
    (svc as unknown as Record<string, unknown>)['whatsapp'] = { initiateWhatsAppCall: initiate };
    await expect(svc.initiateCall('t1', 'u1', { phone: '+233555000111', contactId: 'foreign' } as never)).rejects.toThrow('Contact not found');
    expect(initiate).not.toHaveBeenCalled();
  });
});

describe('CallsService -- contact lookup is exact, never a substring', () => {
  it('an inbound call from +18601671151 attaches only to that exact number', async () => {
    const { svc, prisma } = build(null);
    const findUnique = jest.fn().mockResolvedValue(null);
    (prisma as unknown as { contact: Record<string, jest.Mock> }).contact['findUnique'] = findUnique;
    (svc as unknown as Record<string, unknown>)['whatsapp'] = { initiateWhatsAppCall: jest.fn().mockResolvedValue({ callId: 'w1' }) };
    (prisma.callLog as unknown as Record<string, jest.Mock>)['findFirst'] = jest.fn().mockResolvedValue(null);
    await svc.initiateCall('t1', 'u1', { phone: '+18601671151' } as never).catch(() => undefined);
    expect(findUnique).toHaveBeenCalledWith({ where: { tenantId_phone: { tenantId: 't1', phone: '+18601671151' } }, select: { id: true } });
  });
});

describe('CallsService.initiateCall -- Meta calling errors become actionable', () => {
  const reported = 'Calling API not enabled. Enable calling for this phone number in WhatsApp Manager, or via the settings API: POST /{phone_number_id}/settings with calling configuration.';

  function withMetaFailure(error: Error & { metaCode?: number }, status: { state: string; sipEnabled: boolean; checked: boolean } = { state: 'DISABLED', sipEnabled: false, checked: true }) {
    const { svc, prisma } = build(null);
    prisma.callLog.findFirst = jest.fn().mockResolvedValue(null);
    (prisma.contact as unknown as Record<string, jest.Mock>)['findUnique'] = jest.fn().mockResolvedValue(null);
    const getCallingStatus = jest.fn().mockResolvedValue(status);
    (svc as unknown as Record<string, unknown>)['whatsapp'] = { initiateWhatsAppCall: jest.fn().mockRejectedValue(error), getCallingStatus };
    return { svc, prisma, getCallingStatus };
  }
  const bodyOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (!(e instanceof BadRequestException)) throw e; return (e as BadRequestException).getResponse() as Record<string, unknown>; } throw new Error('expected a rejection'); };

  it('the reported error becomes a plain explanation with steps, plus what Meta reports (read-only)', async () => {
    const { svc, getCallingStatus, prisma } = withMetaFailure(new Error(reported));
    const body = await bodyOf(svc.initiateCall('t1', 'u1', { phone: '+233555000111' } as never));
    expect(body).toMatchObject({ code: 'CALLING_NOT_ENABLED', message: 'Calling is not turned on for this WhatsApp number yet.', callingStatus: { state: 'DISABLED' } });
    expect((body['steps'] as string[]).join(' ')).toContain('WhatsApp Manager');
    expect(body['message']).not.toContain('{phone_number_id}'); // the headline is plain language, not Meta's raw text
    expect(getCallingStatus).toHaveBeenCalledWith('t1');
    expect(prisma.callLog.create).not.toHaveBeenCalled(); // no call record for a call that never started
  });

  it('only the read-only status check is made; nothing on the Meta account is changed', async () => {
    const { svc, getCallingStatus } = withMetaFailure(new Error(reported));
    await bodyOf(svc.initiateCall('t1', 'u1', { phone: '+233555000111' } as never));
    expect(Object.keys((svc as unknown as { whatsapp: object }).whatsapp).sort()).toEqual(['getCallingStatus', 'initiateWhatsAppCall']);
    expect(getCallingStatus).toHaveBeenCalledTimes(1);
  });

  it('other failures do not trigger the status lookup and carry a code for the UI', async () => {
    const err = Object.assign(new Error('(#138006) no approved call permission'), { metaCode: 138006 });
    const { svc, getCallingStatus } = withMetaFailure(err);
    const body = await bodyOf(svc.initiateCall('t1', 'u1', { phone: '+233555000111' } as never));
    expect(body).toMatchObject({ code: 'CALL_PERMISSION_REQUIRED' });
    expect(getCallingStatus).not.toHaveBeenCalled();
  });

  it('an unexpected provider failure never leaks its raw text to the user', async () => {
    const { svc } = withMetaFailure(new Error('socket hang up at internal-host:3001 token=abc'));
    const body = await bodyOf(svc.initiateCall('t1', 'u1', { phone: '+233555000111' } as never));
    expect(body['code']).toBe('CALLING_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toContain('abc');
  });
});
