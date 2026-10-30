import { assertSafeTarget, formatReport, runValidation, type ValidationConfig } from './staging-validation';

const TOKEN = 'secret-token-do-not-print';
const cfg = (over: Partial<ValidationConfig> = {}): ValidationConfig => ({
  apiUrl: 'https://staging.example.test:8443/api/v1', token: TOKEN, digitalSelfA: 'dsAma', digitalSelfB: 'dsKofi', question: 'How much is the red shirt?',
  facts: { mustContain: ['red shirt', 'GH₵50'], mustNotContain: ['discount', 'free delivery'], allowedPrices: ['GH₵50'] }, runs: 3, confirmSyntheticData: true, ...over,
});

interface FakeOpts {
  replyFor?: Record<string, string>;
  assignChangesOwner?: boolean;
  learned?: { dsAma?: boolean; dsKofi?: boolean; dsNew?: boolean };
  featureEnabled?: boolean;
  tools?: Record<string, string[]>;
}
const REPLIES = {
  dsAma: 'Sure! The red shirt is GH₵50 😊 Which size would you like?',
  dsKofi: 'Red shirt: GH₵50. Send the size.',
  dsNew: 'The red shirt is GH₵50. Which size do you need?',
  none: 'The red shirt is GH₵50. Which size do you need?',
};

/** A tiny stand-in for the platform API: just enough state to exercise the validation. */
function fakeApi(opts: FakeOpts = {}) {
  const convs = new Map<string, { assignedTo: { id: string } | null; status: string; ds: string | null }>();
  let n = 0;
  const calls: string[] = [];
  const reply = (key: string) => opts.replyFor?.[key] ?? REPLIES[key as keyof typeof REPLIES];
  const fetchFn = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`);
    expect(init?.headers?.Authorization).toBe(`Bearer ${TOKEN}`);
    const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => structuredClone(body) }); // a real response is a fresh copy each time
    if (method === 'GET' && path === '/digital-self') {
      const item = (id: string, name: string, learned: boolean) => ({ id, name, assignable: true, summary: { hasLearnedTraits: learned } });
      return json({ featureEnabled: opts.featureEnabled ?? true, items: [item('dsAma', 'Ama', opts.learned?.dsAma ?? true), item('dsKofi', 'Kofi', opts.learned?.dsKofi ?? true), item('dsNew', 'New', opts.learned?.dsNew ?? false)] });
    }
    if (method === 'POST' && path === '/ai/test-chat/reset') { const id = `c${++n}`; convs.set(id, { assignedTo: null, status: 'RESOLVED', ds: null }); return json({ conversationId: id }); }
    const conv = /^\/conversations\/(\w+)$/.exec(path);
    if (method === 'GET' && conv) return json(convs.get(conv[1]!)!);
    const assign = /^\/digital-self\/conversations\/(\w+)$/.exec(path);
    if (method === 'PUT' && assign) {
      const c = convs.get(assign[1]!)!;
      c.ds = JSON.parse(init!.body!).digitalSelfId;
      if (opts.assignChangesOwner) c.assignedTo = { id: 'someone' };
      return json({});
    }
    if (method === 'POST' && path === '/ai/test-chat') {
      const last = [...convs.values()].pop()!;
      return json({ message: { content: reply(last.ds ?? 'none') } });
    }
    if (method === 'GET' && path.startsWith('/ai/executions')) {
      const last = [...convs.values()].pop()!;
      return json({ items: [{ toolTrace: (opts.tools?.[last.ds ?? 'none'] ?? ['search_products']).map((name) => ({ name })) }] });
    }
    return json({}, false, 404);
  };
  return { fetchFn, calls };
}
const failed = (r: Awaited<ReturnType<typeof runValidation>>) => r.checks.filter((c) => c.status === 'fail').map((c) => c.name);

describe('runValidation', () => {
  it('passes when two distinguishable agents give the same correct facts, and nothing else changes', async () => {
    const { fetchFn, calls } = fakeApi();
    const report = await runValidation(cfg({ digitalSelfInsufficient: 'dsNew' }), fetchFn);
    expect(failed(report)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(calls.filter((c) => c === 'POST /ai/test-chat')).toHaveLength(3 * 2 + 1 + 1); // runs x 2 agents, no Digital Self, insufficient
    expect(formatReport(report)).toMatch(/RESULT: all checks passed/);
  });

  it('fails when a reply invents a price', async () => {
    const report = await runValidation(cfg(), fakeApi({ replyFor: { dsAma: 'Sure! The red shirt is GH₵40 today 😊 Which size?' } }).fetchFn);
    expect(report.ok).toBe(false);
    expect(failed(report)).toContain('Facts are correct and nothing is invented (agent A)');
    expect(report.checks.find((c) => c.status === 'fail')!.detail).toMatch(/GH₵40/);
  });

  it('fails when a reply invents a discount', async () => {
    const report = await runValidation(cfg(), fakeApi({ replyFor: { dsKofi: 'Red shirt GH₵50. I can give you a discount.' } }).fetchFn);
    expect(failed(report)).toContain('Facts are correct and nothing is invented (agent B)');
  });

  it('fails when assigning a Digital Self changes who owns the conversation', async () => {
    const report = await runValidation(cfg(), fakeApi({ assignChangesOwner: true }).fetchFn);
    expect(failed(report)).toContain('Assigning a Digital Self never changed ownership, status or AI handling');
  });

  it('fails when the two agents are not distinguishable', async () => {
    const same = 'The red shirt is GH₵50. Which size do you need?';
    const report = await runValidation(cfg(), fakeApi({ replyFor: { dsAma: same, dsKofi: same } }).fetchFn);
    expect(failed(report)).toEqual(['The two agents\' replies are distinguishable in style']);
  });

  it('fails when an agent has not learned enough to have a style, instead of passing on a neutral reply', async () => {
    const report = await runValidation(cfg(), fakeApi({ learned: { dsAma: false } }).fetchFn);
    expect(failed(report)).toContain('Both have learned enough of their own replies to have a style');
  });

  it('fails when Digital Self is not switched on for the workspace', async () => {
    expect(failed(await runValidation(cfg(), fakeApi({ featureEnabled: false }).fetchFn))).toContain('Digital Self is switched on for this (synthetic) workspace');
  });

  it('fails when the two agents used different tools, and skips (not passes) when no trace is available', async () => {
    expect(failed(await runValidation(cfg(), fakeApi({ tools: { dsAma: ['search_products'], dsKofi: ['search_products', 'get_product_details'] } }).fetchFn))).toContain('Both used the same tools and knowledge');
    const skipped = await runValidation(cfg(), fakeApi({ tools: { dsAma: [], dsKofi: [], none: [] } }).fetchFn);
    expect(skipped.checks.find((c) => c.name.startsWith('Both used the same tools'))!.status).toBe('skipped');
  });

  it('never prints the token and does not echo response bodies in errors', async () => {
    const report = await runValidation(cfg(), fakeApi().fetchFn);
    expect(JSON.stringify(report) + formatReport(report)).not.toContain(TOKEN);
    await expect(runValidation(cfg(), async () => ({ ok: false, status: 500, json: async () => ({ secret: TOKEN, customer: 'Abena 0244000000' }) }))).rejects.toThrow('GET /digital-self failed with HTTP 500');
    await expect(runValidation(cfg(), async () => ({ ok: false, status: 500, json: async () => ({ secret: TOKEN }) }))).rejects.not.toThrow(TOKEN);
  });
});

describe('assertSafeTarget', () => {
  it('allows staging and local hosts only', () => {
    for (const url of ['https://staging.verzchat.com:8443/api/v1', 'http://localhost:3001/api/v1', 'http://127.0.0.1:3001/api/v1']) expect(() => assertSafeTarget(url, true)).not.toThrow();
  });
  it('refuses a production-looking host, a lookalike, an invalid URL and a missing confirmation', () => {
    for (const url of ['https://app.verzchat.com/api/v1', 'https://verzchat.com/api/v1', 'https://api.verzchat.com/api/v1', 'https://evil-staging.example.com/api/v1', 'https://example.com/staging.x', 'not a url']) {
      expect(() => assertSafeTarget(url, true)).toThrow(/Refusing/);
    }
    expect(() => assertSafeTarget('https://staging.verzchat.com/api/v1', false)).toThrow(/CONFIRM_SYNTHETIC_DATA/);
  });
  it('makes no network call when the target is refused', async () => {
    const fetchFn = jest.fn();
    await expect(runValidation(cfg({ apiUrl: 'https://app.verzchat.com/api/v1' }), fetchFn)).rejects.toThrow(/Refusing/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
