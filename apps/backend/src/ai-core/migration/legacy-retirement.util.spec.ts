import { assessLegacyRetirement, RetirementInput } from './legacy-retirement.util';

const ready: RetirementInput = {
  tenantId: 't1', commerceEnabled: false, v2FlagEnabled: false, aiEnabled: true, aiMode: 'AUTO_REPLY',
  settingsPersonality: 'Warm and playful.',
  agent: { status: 'ACTIVE', personality: 'Warm and playful.', modelKey: 'deepseek-v4-flash', maxResponseTokens: 400 },
  activePrompt: { version: '1.3.0', scriptsFixedReply: false }, currentPromptVersion: '1.3.0', knowledgeArticles: 12,
};
const with_ = (over: Partial<RetirementInput>): RetirementInput => ({ ...ready, ...over });

describe('assessLegacyRetirement', () => {
  it('a workspace on the legacy responder with everything in place is ready, and nothing is changed for it', () => {
    expect(assessLegacyRetirement(ready)).toEqual({ tenantId: 't1', route: 'legacy', ready: true, blockers: [], warnings: [], safeActions: [] });
  });

  it('a workspace already on v2 reports its route', () => {
    expect(assessLegacyRetirement(with_({ v2FlagEnabled: true })).route).toBe('v2');
  });

  it('a Commerce workspace keeps its own generator: ready, with nothing to migrate, whatever else is configured', () => {
    const r = assessLegacyRetirement(with_({ commerceEnabled: true, agent: null, activePrompt: null }));
    expect(r).toMatchObject({ route: 'commerce', ready: true, blockers: [], safeActions: [] });
    expect(r.warnings[0]).toMatch(/keeps CommerceAiService/);
  });

  describe('prompt', () => {
    it.each([
      ['no active prompt', null, /No ACTIVE responder.system prompt/],
      ['an old active version', { version: '1.1.0', scriptsFixedReply: true }, /not v1\.3\.0/],
      ['a current version that still scripts a reply', { version: '1.3.0', scriptsFixedReply: true }, /scripts a fixed customer reply/],
    ])('blocks on %s', (_label, activePrompt, message) => {
      const r = assessLegacyRetirement(with_({ activePrompt }));
      expect(r.ready).toBe(false);
      expect(r.blockers.join(' ')).toMatch(message);
    });
  });

  describe('personality (workspace configuration is never lost, never overwritten)', () => {
    it('fills an agent that has none, as the one safe action', () => {
      const r = assessLegacyRetirement(with_({ agent: { ...ready.agent!, personality: null } }));
      expect(r.ready).toBe(true);
      expect(r.safeActions).toEqual([{ type: 'fill_agent_personality', agentPersonality: 'Warm and playful.' }]);
    });

    it('treats a blank agent personality as none', () => {
      expect(assessLegacyRetirement(with_({ agent: { ...ready.agent!, personality: '   ' } })).safeActions).toHaveLength(1);
    });

    it('blocks, and proposes no overwrite, when both are set and differ', () => {
      const r = assessLegacyRetirement(with_({ agent: { ...ready.agent!, personality: 'Formal and brief.' } }));
      expect(r.ready).toBe(false);
      expect(r.safeActions).toEqual([]);
      expect(r.blockers.join(' ')).toMatch(/both set and differ/);
    });

    it('needs nothing when the workspace has no personality set', () => {
      const r = assessLegacyRetirement(with_({ settingsPersonality: null, agent: { ...ready.agent!, personality: 'Formal.' } }));
      expect(r.ready).toBe(true);
      expect(r.safeActions).toEqual([]);
    });
  });

  describe('agent', () => {
    it('blocks a paused default agent', () => {
      const r = assessLegacyRetirement(with_({ agent: { ...ready.agent!, status: 'PAUSED' } }));
      expect(r.blockers.join(' ')).toMatch(/PAUSED/);
    });

    it('warns (does not block) about a reply limit below the legacy one', () => {
      const r = assessLegacyRetirement(with_({ agent: { ...ready.agent!, maxResponseTokens: 250 } }));
      expect(r.ready).toBe(true);
      expect(r.warnings.join(' ')).toMatch(/250 tokens/);
    });

    it('a missing agent is fine: it is created on the first v2 turn', () => {
      const r = assessLegacyRetirement(with_({ agent: null }));
      expect(r.ready).toBe(true);
      expect(r.warnings.join(' ')).toMatch(/created automatically/);
    });
  });

  it('warns, without blocking, when AI is off or the knowledge base is empty', () => {
    const r = assessLegacyRetirement(with_({ aiEnabled: false, knowledgeArticles: 0 }));
    expect(r.ready).toBe(true);
    expect(r.warnings).toHaveLength(2);
  });
});
