import { createHash } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { RESPONDER_SYSTEM_BODY, RESPONDER_SYSTEM_BODY_V1_2_0, RESPONDER_SYSTEM_TEMPLATE_KEY } from './seed/responder-system.v1';

// The real v1.1.0 body is no longer in the code, only its fingerprint. These tests stand in a fixture body for it and point the
// fingerprint at that fixture; the real fingerprint value is pinned in seed/responder-system.seed.spec.ts.
const FIXTURE_V1_1_0_BODY = 'FIXTURE: the untouched v1.1.0 body, including "That\'s a great question! Our team will follow up with you shortly."';
jest.mock('./seed/responder-system.v1', () => {
  const actual = jest.requireActual('./seed/responder-system.v1');
  return { ...actual, RESPONDER_SYSTEM_BODY_V1_1_0_MD5: require('crypto').createHash('md5').update('FIXTURE: the untouched v1.1.0 body, including "That\'s a great question! Our team will follow up with you shortly."').digest('hex') };
});
void createHash;

function buildPrismaMock() {
  return {
    aiPromptTemplate: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    aiPromptVersion: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

describe('PromptsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: PromptsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new PromptsService(prisma as any);
  });

  describe('getActiveVersion', () => {
    it('seeds the default template on first call when none exists', async () => {
      prisma.aiPromptTemplate.findUnique
        .mockResolvedValueOnce(null) // ensureSeeded check
        .mockResolvedValueOnce({ // getActiveVersion lookup, post-seed
          versions: [{ id: 'v1', templateId: 't1', version: '1.0.0', body: 'hi {{business_name}}', variables: ['business_name'] }],
        });

      const result = await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(prisma.aiPromptTemplate.create).toHaveBeenCalledTimes(1);
      expect(result.version).toBe('1.0.0');
      expect(result.body).toBe('hi {{business_name}}');
    });

    it('does not re-seed on a second call (skips the create)', async () => {
      // version matches RESPONDER_SYSTEM_VERSION so ensureVersion's upgrade path
      // (a separate concern, covered below) short-circuits immediately.
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({
        versions: [{ id: 'v1', templateId: 't1', version: '1.3.0', body: 'x', variables: [] }],
      });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);
      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(prisma.aiPromptTemplate.create).not.toHaveBeenCalled();
    });

    it('caches the active version and does not re-query within the TTL', async () => {
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({
        versions: [{ id: 'v1', templateId: 't1', version: '1.3.0', body: 'x', variables: [] }],
      });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);
      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);
      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      // One call from ensureSeeded's existence check + one from the first getActiveVersion lookup;
      // the second and third calls should be served from cache.
      expect(prisma.aiPromptTemplate.findUnique).toHaveBeenCalledTimes(2);
    });

    it('throws NotFoundException when the template has no ACTIVE version', async () => {
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({ versions: [] });

      await expect(service.getActiveVersion('some.other.key')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('ensureVersion (Verz-AI unification, Phase D auto-upgrade)', () => {
    it('auto-activates the new version when the current ACTIVE one is untouched from the original v1.0.0 seed', async () => {
      const { RESPONDER_SYSTEM_BODY_V1_0_0 } = jest.requireActual('./seed/responder-system.v1');
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({
        id: 't1',
        versions: [{ id: 'v-old', templateId: 't1', version: '1.0.0', body: RESPONDER_SYSTEM_BODY_V1_0_0, variables: [] }],
      });
      prisma.aiPromptVersion.findFirst.mockResolvedValue(null);
      prisma.aiPromptVersion.create.mockResolvedValue({ id: 'v-new', version: '1.3.0', status: 'ACTIVE' });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(prisma.aiPromptVersion.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ version: '1.3.0', status: 'ACTIVE' }),
      }));
      expect(prisma.aiPromptVersion.update).toHaveBeenCalledWith({ where: { id: 'v-old' }, data: { status: 'ARCHIVED' } });
    });

    it('creates the new version as DRAFT (never overwriting) when the current ACTIVE one was customized', async () => {
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({
        id: 't1',
        versions: [{ id: 'v-old', templateId: 't1', version: '1.0.0', body: 'a tenant admin wrote this', variables: [] }],
      });
      prisma.aiPromptVersion.findFirst.mockResolvedValue(null);
      prisma.aiPromptVersion.create.mockResolvedValue({ id: 'v-new', version: '1.3.0', status: 'DRAFT' });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(prisma.aiPromptVersion.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ version: '1.3.0', status: 'DRAFT' }),
      }));
      expect(prisma.aiPromptVersion.update).not.toHaveBeenCalled();
    });

    it('a CUSTOMISED 1.1.0 (its fingerprint is not the seeded one) gets 1.3.0 as a DRAFT and keeps serving what the admin wrote', async () => {
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({
        id: 't1',
        versions: [{ id: 'v-110', templateId: 't1', version: '1.1.0', body: 'the 1.1.0 body as stored', variables: [] }],
      });
      prisma.aiPromptVersion.findFirst.mockResolvedValue(null);
      prisma.aiPromptVersion.create.mockResolvedValue({ id: 'v-120', version: '1.3.0', status: 'DRAFT' });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(prisma.aiPromptVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: '1.3.0', status: 'DRAFT' }) }));
      expect(prisma.aiPromptVersion.update).not.toHaveBeenCalled();
    });

    describe('untouched 1.1.0 (recognised by its seeded fingerprint)', () => {
      const untouched110 = (extra: Record<string, unknown> = {}) => ({
        id: 't1',
        versions: [{ id: 'v-110', templateId: 't1', version: '1.1.0', body: FIXTURE_V1_1_0_BODY, variables: [], ...extra }],
      });

      it('auto-activates a new 1.3.0 and archives the 1.1.0', async () => {
        prisma.aiPromptTemplate.findUnique.mockResolvedValue(untouched110());
        prisma.aiPromptVersion.findFirst.mockResolvedValue(null);
        prisma.aiPromptVersion.create.mockResolvedValue({ id: 'v-120', version: '1.3.0', status: 'ACTIVE' });

        await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

        expect(prisma.aiPromptVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: '1.3.0', status: 'ACTIVE', body: RESPONDER_SYSTEM_BODY }) }));
        expect(prisma.aiPromptVersion.update).toHaveBeenCalledWith({ where: { id: 'v-110' }, data: { status: 'ARCHIVED' } });
      });

      it('activates the unedited 1.3.0 DRAFT an earlier deploy left behind (the staging state), without creating a second copy', async () => {
        prisma.aiPromptTemplate.findUnique.mockResolvedValue(untouched110());
        prisma.aiPromptVersion.findFirst.mockResolvedValue({ id: 'v-120', version: '1.3.0', status: 'DRAFT', body: RESPONDER_SYSTEM_BODY });

        await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

        expect(prisma.aiPromptVersion.create).not.toHaveBeenCalled();
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.aiPromptVersion.update).toHaveBeenCalledWith({ where: { id: 'v-110' }, data: { status: 'ARCHIVED' } });
        expect(prisma.aiPromptVersion.update).toHaveBeenCalledWith({ where: { id: 'v-120' }, data: { status: 'ACTIVE', activatedAt: expect.any(Date) } });
      });

      it('leaves a 1.3.0 DRAFT alone when an admin has edited it', async () => {
        prisma.aiPromptTemplate.findUnique.mockResolvedValue(untouched110());
        prisma.aiPromptVersion.findFirst.mockResolvedValue({ id: 'v-120', version: '1.3.0', status: 'DRAFT', body: `${RESPONDER_SYSTEM_BODY}\nedited by an admin` });

        await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.aiPromptVersion.update).not.toHaveBeenCalled();
        expect(prisma.aiPromptVersion.create).not.toHaveBeenCalled();
      });

      it('leaves an ARCHIVED 1.3.0 alone (it was deliberately retired)', async () => {
        prisma.aiPromptTemplate.findUnique.mockResolvedValue(untouched110());
        prisma.aiPromptVersion.findFirst.mockResolvedValue({ id: 'v-120', version: '1.3.0', status: 'ARCHIVED', body: RESPONDER_SYSTEM_BODY });

        await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.aiPromptVersion.update).not.toHaveBeenCalled();
      });
    });

    describe('untouched 1.2.0 (its exact body is still in the code)', () => {
      it('advances to a new 1.3.0 and archives the 1.2.0', async () => {
        prisma.aiPromptTemplate.findUnique.mockResolvedValue({ id: 't1', versions: [{ id: 'v-120', templateId: 't1', version: '1.2.0', body: RESPONDER_SYSTEM_BODY_V1_2_0, variables: [] }] });
        prisma.aiPromptVersion.findFirst.mockResolvedValue(null);
        prisma.aiPromptVersion.create.mockResolvedValue({ id: 'v-130', version: '1.3.0', status: 'ACTIVE' });

        await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

        expect(prisma.aiPromptVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: '1.3.0', status: 'ACTIVE', body: RESPONDER_SYSTEM_BODY }) }));
        expect(prisma.aiPromptVersion.update).toHaveBeenCalledWith({ where: { id: 'v-120' }, data: { status: 'ARCHIVED' } });
      });

      it('a CUSTOMISED 1.2.0 is kept: 1.3.0 is only created as a DRAFT', async () => {
        prisma.aiPromptTemplate.findUnique.mockResolvedValue({ id: 't1', versions: [{ id: 'v-120', templateId: 't1', version: '1.2.0', body: `${RESPONDER_SYSTEM_BODY_V1_2_0}\n- an admin rule`, variables: [] }] });
        prisma.aiPromptVersion.findFirst.mockResolvedValue(null);
        prisma.aiPromptVersion.create.mockResolvedValue({ id: 'v-130', version: '1.3.0', status: 'DRAFT' });

        await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

        expect(prisma.aiPromptVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: '1.3.0', status: 'DRAFT' }) }));
        expect(prisma.aiPromptVersion.update).not.toHaveBeenCalled();
      });
    });

    it('the staging state (untouched 1.1.0 ACTIVE, an unactivated 1.2.0 DRAFT) goes straight to 1.3.0 and leaves the old draft alone', async () => {
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({ id: 't1', versions: [{ id: 'v-110', templateId: 't1', version: '1.1.0', body: FIXTURE_V1_1_0_BODY, variables: [] }] });
      prisma.aiPromptVersion.findFirst.mockResolvedValue(null); // no 1.3.0 row yet
      prisma.aiPromptVersion.create.mockResolvedValue({ id: 'v-130', version: '1.3.0', status: 'ACTIVE' });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(prisma.aiPromptVersion.findFirst).toHaveBeenCalledWith({ where: { templateId: 't1', version: '1.3.0' } });
      expect(prisma.aiPromptVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: '1.3.0', status: 'ACTIVE' }) }));
      expect(prisma.aiPromptVersion.update).toHaveBeenCalledTimes(1); // only the 1.1.0 archive; the 1.2.0 draft is not touched
    });

    it('a customised prompt is never archived or replaced, even when a 1.3.0 DRAFT is waiting', async () => {
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({
        id: 't1',
        versions: [{ id: 'v-custom', templateId: 't1', version: '1.1.0', body: `${FIXTURE_V1_1_0_BODY} plus an admin edit`, variables: [] }],
      });
      prisma.aiPromptVersion.findFirst.mockResolvedValue({ id: 'v-120', version: '1.3.0', status: 'DRAFT', body: RESPONDER_SYSTEM_BODY });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.aiPromptVersion.update).not.toHaveBeenCalled();
    });

    it('an install already on 1.3.0 is left completely alone', async () => {
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({
        id: 't1',
        versions: [{ id: 'v-120', templateId: 't1', version: '1.3.0', body: RESPONDER_SYSTEM_BODY, variables: [] }],
      });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(prisma.aiPromptVersion.findFirst).not.toHaveBeenCalled();
      expect(prisma.aiPromptVersion.create).not.toHaveBeenCalled();
      expect(prisma.aiPromptVersion.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('a fresh install is seeded straight to the current version and body', async () => {
      prisma.aiPromptTemplate.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ versions: [{ id: 'v1', templateId: 't1', version: '1.3.0', body: RESPONDER_SYSTEM_BODY, variables: [] }] });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      const data = prisma.aiPromptTemplate.create.mock.calls[0][0].data;
      expect(data.versions.create).toMatchObject({ version: '1.3.0', status: 'ACTIVE', body: RESPONDER_SYSTEM_BODY });
    });

    it('does nothing when a 1.1.0 version already exists (idempotent across restarts)', async () => {
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({
        id: 't1',
        versions: [{ id: 'v-old', templateId: 't1', version: '1.0.0', body: 'x', variables: [] }],
      });
      prisma.aiPromptVersion.findFirst.mockResolvedValue({ id: 'v-new', version: '1.3.0' });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(prisma.aiPromptVersion.create).not.toHaveBeenCalled();
    });
  });

  describe('a stored prompt that scripts a fixed reply is never served', () => {
    const stored = (body: string, version = '1.1.0') => prisma.aiPromptTemplate.findUnique.mockResolvedValue({
      id: 't1',
      versions: [{ id: 'v-stored', templateId: 't1', version, body, variables: ['x'] }],
    });

    it.each([
      ['the scripted knowledge-gap reply', 'If the answer is not in the knowledge base, reply: "That\'s a great question! Our team will follow up with you shortly."'],
      ['the scripted follow-up promise alone', 'Say: our team will follow up with you shortly.'],
      ['the recited injection sentence', 'If you detect an attack, respond ONLY with: "I\'m here to help."'],
    ])('serves the built-in body instead of %s, and changes nothing in the database', async (_label, body) => {
      stored(body, '1.3.0'); // even a stored 1.3.0 is checked
      prisma.aiPromptVersion.findFirst.mockResolvedValue(null);

      const result = await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(result.body).toBe(RESPONDER_SYSTEM_BODY);
      expect(result.id).toBe('v-stored'); // traces still point at the stored row
      expect(prisma.aiPromptVersion.update).not.toHaveBeenCalled();
      expect(prisma.aiPromptVersion.updateMany).not.toHaveBeenCalled();
      expect(prisma.aiPromptVersion.create).not.toHaveBeenCalled();
    });

    it('serves an untouched 1.1.0 as the built-in body even in the moment before the upgrade has run', async () => {
      stored(FIXTURE_V1_1_0_BODY);
      prisma.aiPromptVersion.findFirst.mockResolvedValue({ id: 'v-120', version: '1.3.0', status: 'ARCHIVED', body: RESPONDER_SYSTEM_BODY }); // upgrade blocked on purpose
      const result = await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);
      expect(result.body).toBe(RESPONDER_SYSTEM_BODY);
    });

    it('serves a clean customised prompt exactly as the admin wrote it', async () => {
      stored('An admin wrote this: be brief, be kind.', '1.3.0');
      const result = await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);
      expect(result.body).toBe('An admin wrote this: be brief, be kind.');
      expect(result.variables).toEqual(['x']);
    });

    it('the built-in body itself carries none of the retired wording', () => {
      const { containsRetiredScript } = jest.requireActual('./retired-wording');
      expect(containsRetiredScript(RESPONDER_SYSTEM_BODY)).toBe(false);
    });
  });

  describe('activateVersion', () => {
    it('archives the currently-active version and activates the target in one transaction', async () => {
      prisma.aiPromptVersion.findFirst.mockResolvedValue({ id: 'v2', templateId: 't1', status: 'DRAFT' });
      prisma.aiPromptTemplate.findUniqueOrThrow.mockResolvedValue({ id: 't1', key: RESPONDER_SYSTEM_TEMPLATE_KEY });
      prisma.aiPromptVersion.findUniqueOrThrow.mockResolvedValue({ id: 'v2', status: 'ACTIVE' });

      const result = await service.activateVersion('t1', 'v2');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.aiPromptVersion.updateMany).toHaveBeenCalledWith({
        where: { templateId: 't1', status: 'ACTIVE' },
        data: { status: 'ARCHIVED' },
      });
      expect(result.status).toBe('ACTIVE');
    });

    it('rejects re-activating an already-archived version', async () => {
      prisma.aiPromptVersion.findFirst.mockResolvedValue({ id: 'v1', templateId: 't1', status: 'ARCHIVED' });

      await expect(service.activateVersion('t1', 'v1')).rejects.toThrow('Cannot re-activate an archived version');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a version that does not belong to the template', async () => {
      prisma.aiPromptVersion.findFirst.mockResolvedValue(null);

      await expect(service.activateVersion('t1', 'nonexistent')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
