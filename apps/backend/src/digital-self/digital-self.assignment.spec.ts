import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { AssignDigitalSelfDto } from './dto';
import { DigitalSelfService } from './digital-self.service';

const USER = { name: 'Ama', role: 'AGENT', avatarUrl: null, isActive: true };
const ds = (id: string, userId: string, over: Record<string, unknown> = {}) => ({ id, tenantId: 't1', userId, enabled: true, learningPaused: false, evidenceCount: 20, lastLearnedAt: new Date(), lastError: null, profileVersion: 1, profile: {}, ...over });

function build(opts: { conv?: Record<string, unknown> | null; selves?: Array<Record<string, unknown>>; assignable?: boolean } = {}) {
  const selves = opts.selves ?? [ds('dsAma', 'ama'), ds('dsKofi', 'kofi')];
  const conv = opts.conv === undefined ? { id: 'c1', assignedToId: 'kofi', digitalSelfId: null } : opts.conv;
  const prisma = {
    conversation: {
      findFirst: jest.fn(async ({ where }) => (conv && where.id === conv['id'] && where.tenantId === 't1' ? { ...conv } : null)),
      updateMany: jest.fn(async ({ data }) => { if (conv) Object.assign(conv, data); return { count: conv ? 1 : 0 }; }),
    },
    digitalSelf: {
      findFirst: jest.fn(async ({ where }) => {
        const r = selves.find((x) => (where.id ? x['id'] === where.id : x['userId'] === where.userId) && x['tenantId'] === where.tenantId);
        return r ? { ...r, user: USER } : null;
      }),
    },
    user: { count: jest.fn().mockResolvedValue(opts.assignable === false ? 0 : 1) },
  };
  return { svc: new DigitalSelfService(prisma as never), prisma, conv };
}
const admin = { id: 'boss', role: 'ADMIN' };

describe('assignToConversation', () => {
  it('assigns, changes and removes a Digital Self', async () => {
    const { svc, conv } = build();
    expect((await svc.assignToConversation('t1', 'c1', 'dsAma', admin)).digitalSelf?.id).toBe('dsAma');
    expect(conv!['digitalSelfId']).toBe('dsAma');
    expect((await svc.assignToConversation('t1', 'c1', 'dsKofi', admin)).digitalSelf?.id).toBe('dsKofi');
    const removed = await svc.assignToConversation('t1', 'c1', null, admin);
    expect(conv!['digitalSelfId']).toBeNull();
    expect(removed.source).toBe('owner'); // falls back to the human owner's own, not to nothing weird
  });

  it('writes only digitalSelfId: never human ownership, never AI settings', async () => {
    const { svc, prisma } = build();
    await svc.assignToConversation('t1', 'c1', 'dsAma', admin);
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', tenantId: 't1' }, data: { digitalSelfId: 'dsAma' } });
  });

  it('rejects a Digital Self from another tenant and a conversation from another tenant', async () => {
    const { svc, conv } = build({ selves: [ds('dsOther', 'x', { tenantId: 't2' })] });
    await expect(svc.assignToConversation('t1', 'c1', 'dsOther', admin)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.assignToConversation('t2', 'c1', 'dsOther', admin)).rejects.toBeInstanceOf(NotFoundException);
    expect(conv!['digitalSelfId']).toBeNull();
  });

  it('rejects a deactivated Digital Self and an agent who is no longer active', async () => {
    const off = build({ selves: [ds('dsAma', 'ama', { enabled: false })] });
    await expect(off.svc.assignToConversation('t1', 'c1', 'dsAma', admin)).rejects.toBeInstanceOf(BadRequestException);
    const gone = build({ assignable: false });
    await expect(gone.svc.assignToConversation('t1', 'c1', 'dsAma', admin)).rejects.toBeInstanceOf(BadRequestException);
    expect(gone.conv!['digitalSelfId']).toBeNull();
  });

  it('lets an agent change only a conversation they own; viewers and other agents are refused', async () => {
    const own = build({ conv: { id: 'c1', assignedToId: 'kofi', digitalSelfId: null } });
    await expect(own.svc.assignToConversation('t1', 'c1', 'dsAma', { id: 'kofi', role: 'AGENT' })).resolves.toBeDefined();
    const other = build();
    await expect(other.svc.assignToConversation('t1', 'c1', 'dsAma', { id: 'ama', role: 'AGENT' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(other.svc.assignToConversation('t1', 'c1', 'dsAma', { id: 'v', role: 'VIEWER' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(other.conv!['digitalSelfId']).toBeNull();
  });
});

describe('getForConversation', () => {
  it('prefers the explicit assignment, then the human owner\'s, then none', async () => {
    expect((await build({ conv: { id: 'c1', assignedToId: 'kofi', digitalSelfId: 'dsAma' } }).svc.getForConversation('t1', 'c1')).source).toBe('assigned');
    const owner = await build({ conv: { id: 'c1', assignedToId: 'kofi', digitalSelfId: null } }).svc.getForConversation('t1', 'c1');
    expect(owner).toMatchObject({ source: 'owner', digitalSelf: { id: 'dsKofi' } });
    expect(await build({ conv: { id: 'c1', assignedToId: null, digitalSelfId: null } }).svc.getForConversation('t1', 'c1')).toEqual({ source: null, digitalSelf: null });
  });
  it('treats an AI-owned conversation as having no default (no random pick)', async () => {
    expect((await build({ conv: { id: 'c1', assignedToId: 'verz-ai', digitalSelfId: null } }).svc.getForConversation('t1', 'c1')).source).toBeNull();
  });
});

describe('AssignDigitalSelfDto', () => {
  const check = async (v: unknown) => (await validate(Object.assign(new AssignDigitalSelfDto(), v as object))).length;
  it('requires an explicit id or null; an empty body or a non-UUID is invalid', async () => {
    expect(await check({ digitalSelfId: null })).toBe(0);
    expect(await check({ digitalSelfId: '3f1b9c2e-1d4a-4b6e-8c7f-0a1b2c3d4e5f' })).toBe(0);
    expect(await check({})).toBeGreaterThan(0);
    expect(await check({ digitalSelfId: 'ama' })).toBeGreaterThan(0);
  });
});
