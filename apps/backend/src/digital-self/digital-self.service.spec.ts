import { DigitalSelfService, provisionDigitalSelf } from './digital-self.service';

function fakeDb(users: Array<{ id: string; tenantId: string; isAiAgent: boolean; role: string }>) {
  const selves = new Map<string, { id: string; tenantId: string; userId: string }>();
  const matches = (u: (typeof users)[number], where: Record<string, unknown>) =>
    (where['id'] === undefined || where['id'] === u.id) && (where['tenantId'] === undefined || where['tenantId'] === u.tenantId) &&
    (where['isAiAgent'] === undefined || where['isAiAgent'] === u.isAiAgent) &&
    (where['role'] === undefined || (where['role'] as { in: string[] }).in.includes(u.role)) &&
    (where['digitalSelf'] === undefined || !selves.has(u.id));
  return {
    selves,
    user: {
      findFirst: jest.fn(async ({ where }) => users.find((u) => matches(u, where)) ?? null),
      findMany: jest.fn(async ({ where }) => users.filter((u) => matches(u, where))),
    },
    digitalSelf: {
      createMany: jest.fn(async ({ data }: { data: Array<{ tenantId: string; userId: string }> }) => {
        let count = 0;
        for (const d of data) if (!selves.has(d.userId)) { selves.set(d.userId, { id: `ds-${d.userId}`, ...d }); count++; }
        return { count };
      }),
      findUnique: jest.fn(async ({ where }) => selves.get(where.userId) ?? null),
    },
  };
}

const USERS = [
  { id: 'ama', tenantId: 't1', isAiAgent: false, role: 'AGENT' },
  { id: 'kofi', tenantId: 't1', isAiAgent: false, role: 'ADMIN' },
  { id: 'verz', tenantId: 't1', isAiAgent: true, role: 'AGENT' },
  { id: 'viewer', tenantId: 't1', isAiAgent: false, role: 'VIEWER' },
  { id: 'other', tenantId: 't2', isAiAgent: false, role: 'AGENT' },
];

describe('provisionDigitalSelf', () => {
  it('creates one Digital Self per agent and is idempotent', async () => {
    const db = fakeDb(USERS);
    const a = await provisionDigitalSelf(db as never, 't1', 'ama');
    const b = await provisionDigitalSelf(db as never, 't1', 'ama');
    expect(a?.id).toBe(b?.id);
    expect(db.selves.size).toBe(1);
  });
  it('refuses the AI user, view-only users and users of another tenant', async () => {
    const db = fakeDb(USERS);
    expect(await provisionDigitalSelf(db as never, 't1', 'verz')).toBeNull();
    expect(await provisionDigitalSelf(db as never, 't1', 'viewer')).toBeNull();
    expect(await provisionDigitalSelf(db as never, 't1', 'other')).toBeNull();
    expect(db.selves.size).toBe(0);
  });
});

describe('DigitalSelfService.ensureForTenant', () => {
  it('provisions only the missing human agents of that tenant and is safe to repeat', async () => {
    const db = fakeDb(USERS);
    const svc = new DigitalSelfService(db as never);
    expect(await svc.ensureForTenant('t1')).toBe(2);
    expect([...db.selves.keys()].sort()).toEqual(['ama', 'kofi']);
    expect(await svc.ensureForTenant('t1')).toBe(0);
  });
});

describe('assignableUserWhere', () => {
  it('requires the same tenant, an active human agent, and no suspended or pending membership', () => {
    expect(DigitalSelfService.assignableUserWhere('t1')).toMatchObject({
      tenantId: 't1', isActive: true, isAiAgent: false, workspaceMemberships: { none: { workspaceId: 't1', status: { not: 'ACTIVE' } } },
    });
  });
});
