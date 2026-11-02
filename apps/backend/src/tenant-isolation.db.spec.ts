/**
 * Tenant isolation against a REAL Postgres (every project migration applied), with two real workspaces and two real user identities.
 * Skipped unless TENANT_ISOLATION_TEST_DATABASE_URL is set, so the normal run stays hermetic:
 *   TENANT_ISOLATION_TEST_DATABASE_URL=postgresql://user:pw@127.0.0.1:5432/isolation_test npx jest src/tenant-isolation.db.spec.ts
 * The suite TRUNCATEs tenants, so it refuses any database whose name does not contain "test", "scratch" or "tmp".
 *
 * Each case acts as workspace A and tries to read, change, delete or attach workspace B's data, then checks B's rows in the database,
 * not only the thrown error.
 */
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ContactsService } from './contacts/contacts.service';
import { AutomationService } from './automation/automation.service';
import { TagsService } from './manage/tags/tags.service';
import { TeamsService } from './teams/teams.service';
import { ApiKeysService } from './api-keys/api-keys.service';
import { SegmentsService } from './segments/segments.service';
import { JwtStrategy } from './auth/strategies/jwt.strategy';

const url = process.env['TENANT_ISOLATION_TEST_DATABASE_URL'];
if (url && !/(test|scratch|tmp)/i.test(new URL(url).pathname)) {
  throw new Error('TENANT_ISOLATION_TEST_DATABASE_URL must point at a database whose name contains "test", "scratch" or "tmp".');
}
const describeDb = url ? describe : describe.skip;

describeDb('tenant isolation (real database, two workspaces)', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? 'postgresql://skipped:skipped@127.0.0.1:1/skipped' } } });
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';
  const ids = {} as Record<string, string>;

  const contacts = new ContactsService(prisma as never);
  const automation = new AutomationService(prisma as never);
  const tags = new TagsService(prisma as never);
  const teams = new TeamsService(prisma as never);
  const apiKeys = new ApiKeysService(prisma as never);
  const segments = new SegmentsService(prisma as never);
  const jwt = new JwtStrategy({ get: () => 'test-secret' } as never, prisma as never);

  beforeAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE tenants CASCADE');
    for (const [id, name] of [[A, 'Workspace A'], [B, 'Workspace B']] as const) {
      await prisma.tenant.create({ data: { id, name, webhookVerifyToken: `verify-${name}` } });
    }
    const mkUser = (tenantId: string, email: string) => prisma.user.create({ data: { tenantId, email, passwordHash: 'x', name: email } });
    ids['userA'] = (await mkUser(A, 'a@a.test')).id;
    ids['userB'] = (await mkUser(B, 'b@b.test')).id;
    await prisma.workspaceMember.create({ data: { workspaceId: A, userId: ids['userA']!, role: 'ADMIN' } });
    await prisma.workspaceMember.create({ data: { workspaceId: B, userId: ids['userB']!, role: 'ADMIN' } });
    ids['contactB'] = (await prisma.contact.create({ data: { tenantId: B, phone: '+233500000002', name: 'B customer' } })).id;
    ids['ruleB'] = (await automation.create(B, { name: 'B rule', trigger: 'CONVERSATION_CREATED', conditions: [], actions: [], priority: 1 } as never)).id;
    ids['tagB'] = (await prisma.tag.create({ data: { tenantId: B, name: 'vip-b', color: '#000000' } })).id;
    ids['teamB'] = (await prisma.team.create({ data: { tenantId: B, name: 'Team B' } })).id;
    ids['segmentB'] = (await prisma.contactSegment.create({ data: { tenantId: B, name: 'Segment B', filters: [] as never } })).id;
    const key = await apiKeys.create(B, ids['userB']!, 'B key');
    ids['keyB'] = key.id;
    ids['rawKeyB'] = key.key;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  describe('workspace A acting on workspace B ids', () => {
    it('cannot read, update, block or delete a B contact, and the row is untouched', async () => {
      await expect(contacts.findOne(A, ids['contactB']!)).rejects.toBeInstanceOf(NotFoundException);
      await expect(contacts.update(A, ids['contactB']!, { name: 'hijacked' } as never)).rejects.toBeInstanceOf(NotFoundException);
      await expect(contacts.toggleBlock(A, ids['contactB']!)).rejects.toBeInstanceOf(NotFoundException);
      await expect(contacts.remove(A, ids['contactB']!)).rejects.toBeInstanceOf(NotFoundException);
      const row = await prisma.contact.findUnique({ where: { id: ids['contactB']! } });
      expect(row).toMatchObject({ tenantId: B, name: 'B customer', isBlocked: false });
    });

    it('does not see B contacts in a list', async () => {
      const list = await contacts.findAll(A);
      expect(JSON.stringify(list)).not.toContain('B customer');
    });

    it('cannot read, update or delete a B automation rule', async () => {
      await expect(automation.findOne(A, ids['ruleB']!)).rejects.toBeInstanceOf(NotFoundException);
      await expect(automation.update(A, ids['ruleB']!, { name: 'hijacked' } as never)).rejects.toBeInstanceOf(NotFoundException);
      await expect(automation.remove(A, ids['ruleB']!)).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.automationRule.findUnique({ where: { id: ids['ruleB']! } })).toMatchObject({ tenantId: B, name: 'B rule' });
      expect(await automation.findAll(A)).toEqual([]);
    });

    it('cannot update or delete a B tag', async () => {
      await expect(tags.update(ids['tagB']!, A, { name: 'hijacked' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(tags.remove(ids['tagB']!, A)).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.tag.findUnique({ where: { id: ids['tagB']! } })).toMatchObject({ tenantId: B, name: 'vip-b' });
    });

    it('cannot change a B team, and cannot add a B user to an A team', async () => {
      await expect(teams.update(A, ids['teamB']!, 'hijacked')).rejects.toBeInstanceOf(NotFoundException);
      await expect(teams.remove(A, ids['teamB']!)).rejects.toBeInstanceOf(NotFoundException);
      const teamA = await teams.create(A, 'Team A');
      await expect(teams.addMember(A, teamA.id, ids['userB']!)).rejects.toBeInstanceOf(NotFoundException);
      await expect(teams.addMember(A, ids['teamB']!, ids['userA']!)).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.teamMember.count({ where: { OR: [{ teamId: teamA.id }, { teamId: ids['teamB']! }] } })).toBe(0);
    });

    it('cannot update or delete a B segment', async () => {
      await expect(segments.update(ids['segmentB']!, A, { name: 'hijacked' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(segments.remove(ids['segmentB']!, A)).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.contactSegment.findUnique({ where: { id: ids['segmentB']! } })).toMatchObject({ tenantId: B, name: 'Segment B' });
    });

    it('cannot revoke or delete a B API key; the key keeps working for B and nobody else owns it', async () => {
      await expect(apiKeys.revoke(ids['keyB']!, A)).rejects.toBeInstanceOf(NotFoundException);
      await expect(apiKeys.delete(ids['keyB']!, A)).rejects.toBeInstanceOf(NotFoundException);
      expect(await apiKeys.list(A)).toEqual([]);
      expect(await apiKeys.validateKey(ids['rawKeyB']!)).toMatchObject({ tenantId: B, id: ids['keyB'] });
    });
  });

  describe('the second identity: a workspace A user token pointed at workspace B', () => {
    it('is rejected by the JWT strategy', async () => {
      await expect(jwt.validate({ sub: ids['userA']!, tenantId: B, email: 'a@a.test', role: 'ADMIN' } as never)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('works for its own workspace and carries that workspace, never the one in another token', async () => {
      await expect(jwt.validate({ sub: ids['userA']!, tenantId: A, email: 'a@a.test', role: 'ADMIN' } as never)).resolves.toMatchObject({ tenantId: A, sub: ids['userA'] });
    });

    it('is rejected once the membership is suspended, the user deactivated, or the workspace suspended', async () => {
      const payload = { sub: ids['userB']!, tenantId: B, email: 'b@b.test', role: 'ADMIN' } as never;
      await expect(jwt.validate(payload)).resolves.toBeDefined();
      await prisma.workspaceMember.updateMany({ where: { userId: ids['userB']! }, data: { status: 'SUSPENDED' } });
      await expect(jwt.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
      await prisma.workspaceMember.updateMany({ where: { userId: ids['userB']! }, data: { status: 'ACTIVE' } });
      await prisma.user.update({ where: { id: ids['userB']! }, data: { isActive: false } });
      await expect(jwt.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
      await prisma.user.update({ where: { id: ids['userB']! }, data: { isActive: true } });
      await prisma.tenant.update({ where: { id: B }, data: { isActive: false } });
      await expect(jwt.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
      await prisma.tenant.update({ where: { id: B }, data: { isActive: true } });
    });
  });
});
