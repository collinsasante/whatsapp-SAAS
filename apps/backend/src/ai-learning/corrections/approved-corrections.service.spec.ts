import { ApprovedCorrectionsService } from './approved-corrections.service';

type Row = { id: string; tenantId: string; status: string; customerInput: string; expectedAction: string | null; expectedResponse: string | null; approvedAt: Date | null; updatedAt: Date };

/** A tiny in-memory stand-in for the table that honours the `where` it is given, so isolation is tested by behaviour, not by inspecting the query. */
function storeWith(rows: Row[]) {
  const findMany = jest.fn(async ({ where, take }: { where: { tenantId: string; status: string }; take: number }) =>
    rows.filter((r) => r.tenantId === where.tenantId && r.status === where.status).slice(0, take));
  return { prisma: { aiTrainingExample: { findMany } }, findMany };
}

const row = (over: Partial<Row>): Row => ({
  id: 'r', tenantId: 'tenant-a', status: 'APPROVED', customerInput: 'Do you deliver to Kumasi?', expectedAction: null,
  expectedResponse: 'Yes, Kumasi takes 2 days.', approvedAt: new Date(2026, 5, 1), updatedAt: new Date(2026, 5, 1), ...over,
});

const ask = (svc: ApprovedCorrectionsService, tenant = 'tenant-a') => svc.getGuidanceBlock(tenant, 'can you deliver to Kumasi');

describe('ApprovedCorrectionsService', () => {
  afterEach(() => { delete process.env.AI_CORRECTIONS_DISABLED; });

  it('returns guidance from an approved example of the same tenant', async () => {
    const { prisma } = storeWith([row({ id: 'ok' })]);
    expect(await ask(new ApprovedCorrectionsService(prisma as never))).toContain('Kumasi takes 2 days');
  });

  describe('tenant isolation', () => {
    it("never uses another tenant's approved example", async () => {
      const { prisma } = storeWith([row({ id: 'b', tenantId: 'tenant-b', expectedResponse: 'TENANT B SECRET PRICE LIST' })]);
      expect(await ask(new ApprovedCorrectionsService(prisma as never), 'tenant-a')).toBe('');
    });

    it('serves each tenant only its own example when both exist', async () => {
      const { prisma } = storeWith([
        row({ id: 'a', tenantId: 'tenant-a', expectedResponse: 'A says two days' }),
        row({ id: 'b', tenantId: 'tenant-b', expectedResponse: 'B says five days' }),
      ]);
      const svc = new ApprovedCorrectionsService(prisma as never);
      expect(await ask(svc, 'tenant-a')).toContain('A says two days');
      expect(await ask(svc, 'tenant-a')).not.toContain('B says');
      expect(await ask(svc, 'tenant-b')).toContain('B says five days');
    });

    it('always queries with the tenant id and the APPROVED status', async () => {
      const { prisma, findMany } = storeWith([]);
      await ask(new ApprovedCorrectionsService(prisma as never), 'tenant-a');
      expect(findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 'tenant-a', status: 'APPROVED' });
    });

    it('leaves out a style correction that is applied to one agent\'s Digital Self, so it cannot steer every other agent', async () => {
      const { prisma, findMany } = storeWith([]);
      await ask(new ApprovedCorrectionsService(prisma as never), 'tenant-a');
      expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-a', status: 'APPROVED', digitalSelfId: null });
    });

    it('does not query at all without a tenant', async () => {
      const { prisma, findMany } = storeWith([row({})]);
      expect(await new ApprovedCorrectionsService(prisma as never).getGuidanceBlock('', 'deliver to Kumasi')).toBe('');
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  describe('approval status', () => {
    it.each(['DRAFT', 'REVIEW', 'REJECTED', 'ARCHIVED'])('never uses a %s example', async (status) => {
      const { prisma } = storeWith([row({ status })]);
      expect(await ask(new ApprovedCorrectionsService(prisma as never))).toBe('');
    });
  });

  describe('relevance', () => {
    it('returns nothing for an unrelated question even when approved examples exist', async () => {
      const { prisma } = storeWith([row({})]);
      expect(await new ApprovedCorrectionsService(prisma as never).getGuidanceBlock('tenant-a', 'what is the price of the red sneakers')).toBe('');
    });

    it('does not query for an empty message', async () => {
      const { prisma, findMany } = storeWith([row({})]);
      expect(await new ApprovedCorrectionsService(prisma as never).getGuidanceBlock('tenant-a', '   ')).toBe('');
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  describe('failure and switch-off', () => {
    it('returns an empty block, not an error, when the database fails', async () => {
      const prisma = { aiTrainingExample: { findMany: jest.fn().mockRejectedValue(new Error('connection refused')) } };
      await expect(ask(new ApprovedCorrectionsService(prisma as never))).resolves.toBe('');
    });

    it('does not put customer message text in the failure log', async () => {
      const prisma = { aiTrainingExample: { findMany: jest.fn().mockRejectedValue(new Error('boom')) } };
      const svc = new ApprovedCorrectionsService(prisma as never);
      const warn = jest.spyOn(svc['logger'], 'warn').mockImplementation(() => undefined);
      await svc.getGuidanceBlock('tenant-a', 'my secret order about Kumasi');
      expect(warn.mock.calls[0][0]).not.toContain('Kumasi');
    });

    it('can be switched off without a code change', async () => {
      process.env.AI_CORRECTIONS_DISABLED = 'true';
      const { prisma, findMany } = storeWith([row({})]);
      expect(await ask(new ApprovedCorrectionsService(prisma as never))).toBe('');
      expect(findMany).not.toHaveBeenCalled();
    });
  });
});
