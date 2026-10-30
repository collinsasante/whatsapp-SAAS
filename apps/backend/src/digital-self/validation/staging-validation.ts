import { checkFacts, compareStyles, measureReply, type FactRules, type StyleMetrics } from './style-compare.util';

/**
 * Repeatable check that two agents' Digital Selves change HOW Verz AI writes and nothing else. It drives the AI Test Chat (the real
 * message pipeline with a simulated contact: nothing is sent to any channel) on a SYNTHETIC staging workspace, asking the same
 * question in a fresh conversation per run, once as each agent. It needs model credentials on the target, so it cannot run in CI.
 */
export interface ValidationConfig {
  /** e.g. https://staging.verzchat.com:8443/api/v1 */
  apiUrl: string;
  /** An admin token for the synthetic workspace. Sent only as a header; never printed. */
  token: string;
  digitalSelfA: string;
  digitalSelfB: string;
  /** A Digital Self with too little learned (optional): its replies must still be correct and neutral. */
  digitalSelfInsufficient?: string;
  question: string;
  facts: FactRules;
  /** Questions asked per agent, each in a fresh conversation. More runs damp the noise of a single reply. */
  runs: number;
  /** The operator's statement that the target workspace holds synthetic data only. */
  confirmSyntheticData: boolean;
  /** Minimum time between test-chat sends. The endpoint allows 3 per minute per user, so the default keeps just under that. */
  requestGapMs?: number;
  /** Replaceable so tests do not really wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Progress lines for the operator (the run takes a few minutes because of the rate limit). */
  onProgress?: (message: string) => void;
}

/** 3 sends per minute => one every 20 s; one second of margin. */
export const DEFAULT_REQUEST_GAP_MS = 21_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_WAIT_S = 120;

export interface Check {
  name: string;
  status: 'pass' | 'fail' | 'skipped';
  detail?: string;
}

export interface ValidationReport {
  ok: boolean;
  checks: Check[];
  replies: Record<'A' | 'B' | 'none' | 'insufficient', string[]>;
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; headers?: { get(name: string): string | null } }>;

/** Only staging or a local environment. A production-looking host is refused even with the confirmation flag. */
export function assertSafeTarget(apiUrl: string, confirmSyntheticData: boolean): void {
  if (!confirmSyntheticData) throw new Error('Refusing to run: set CONFIRM_SYNTHETIC_DATA=yes to confirm the target workspace holds synthetic data only.');
  let host: string;
  try { host = new URL(apiUrl).hostname.toLowerCase(); } catch { throw new Error('Refusing to run: STAGING_API_URL is not a valid URL.'); }
  const local = host === 'localhost' || host === '127.0.0.1';
  const staging = host.startsWith('staging.') || host.includes('.staging.') || host.endsWith('.staging');
  if (!local && !staging) throw new Error(`Refusing to run against "${host}": only a staging or local host is allowed.`);
}

const toolNames = (trace: unknown): string[] =>
  Array.isArray(trace) ? [...new Set(trace.map((t) => (t as { name?: string; tool?: string })?.name ?? (t as { tool?: string })?.tool).filter((n): n is string => !!n))].sort() : [];

export async function runValidation(cfg: ValidationConfig, fetchFn: Fetch): Promise<ValidationReport> {
  assertSafeTarget(cfg.apiUrl, cfg.confirmSyntheticData);
  const base = cfg.apiUrl.replace(/\/+$/, '');
  const checks: Check[] = [];
  const add = (name: string, problems: string[] | boolean, detail?: string) => {
    const ok = Array.isArray(problems) ? problems.length === 0 : problems;
    checks.push({ name, status: ok ? 'pass' : 'fail', detail: ok ? detail : Array.isArray(problems) ? problems.join('; ') : detail });
  };
  const skip = (name: string, detail: string) => checks.push({ name, status: 'skipped', detail });

  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const gap = cfg.requestGapMs ?? DEFAULT_REQUEST_GAP_MS;
  let lastPacedAt = 0;

  /** `paced` calls are the rate-limited test-chat sends: spaced out, and retried after the wait the server asks for. */
  async function call<T>(method: string, path: string, body?: unknown, paced = false): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (paced && gap > 0 && lastPacedAt > 0) {
        const wait = gap - (Date.now() - lastPacedAt);
        if (wait > 0) { cfg.onProgress?.(`Waiting ${Math.ceil(wait / 1000)}s for the test-chat rate limit...`); await sleep(wait); }
      }
      if (paced) lastPacedAt = Date.now();
      const res = await fetchFn(`${base}${path}`, { method, headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        // Only the limit's scope and wait are read from the body; nothing else is kept or printed.
        const info = (await res.json().catch(() => ({}))) as { scope?: string; retryAfterSeconds?: number };
        if (info.scope === 'tenant_daily' || info.scope === 'eval_runs_daily') {
          throw new Error(`${method} ${path}: this workspace has used its daily test allowance; it resets at 00:00 UTC. Nothing was retried.`);
        }
        const asked = Number(info.retryAfterSeconds ?? res.headers?.get('retry-after') ?? 61);
        const seconds = Math.min(MAX_RATE_LIMIT_WAIT_S, Math.max(1, Number.isFinite(asked) ? asked : 61)) + 1;
        cfg.onProgress?.(`Rate limited (HTTP 429). Waiting ${seconds}s, then retrying (${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})...`);
        await sleep(seconds * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`${method} ${path} failed with HTTP ${res.status}`); // the body is not echoed: it may carry workspace data
      return (await res.json()) as T;
    }
  }

  // ---- Preconditions
  type DsView = { id: string; name: string; assignable: boolean; summary: { hasLearnedTraits: boolean } };
  const list = await call<{ featureEnabled: boolean; items: DsView[] }>('GET', '/digital-self');
  add('Digital Self is switched on for this (synthetic) workspace', list.featureEnabled, 'enable the digital_self flag for this workspace only');
  const byId = new Map(list.items.map((i) => [i.id, i]));
  const [a, b, c] = [byId.get(cfg.digitalSelfA), byId.get(cfg.digitalSelfB), cfg.digitalSelfInsufficient ? byId.get(cfg.digitalSelfInsufficient) : undefined];
  add('Both Digital Selves exist and can be assigned', !!a?.assignable && !!b?.assignable, 'check the ids; an agent must be active with an enabled Digital Self');
  add('Both have learned enough of their own replies to have a style', !!a?.summary.hasLearnedTraits && !!b?.summary.hasLearnedTraits, 'seed synthetic history first (see docs/digital-self-staging-validation.md)');
  if (cfg.digitalSelfInsufficient) add('The "insufficient learning" Digital Self really has too little learned', !!c && !c.summary.hasLearnedTraits, 'pick an agent with fewer than the minimum replies');
  if (!a || !b) return { ok: false, checks, replies: { A: [], B: [], none: [], insufficient: [] } };

  // ---- Ask the same question as each agent, each time in a fresh conversation
  const replies = { A: [] as string[], B: [] as string[], none: [] as string[], insufficient: [] as string[] };
  const tools: Record<string, string[][]> = { A: [], B: [], none: [], insufficient: [] };
  const ownership: string[] = [];

  async function ask(label: keyof typeof replies, digitalSelfId: string | null): Promise<void> {
    const { conversationId } = await call<{ conversationId: string }>('POST', '/ai/test-chat/reset');
    const before = await call<{ assignedTo?: { id: string } | null; status: string }>('GET', `/conversations/${conversationId}`);
    if (digitalSelfId) await call('PUT', `/digital-self/conversations/${conversationId}`, { digitalSelfId });
    const after = await call<{ assignedTo?: { id: string } | null; status: string }>('GET', `/conversations/${conversationId}`);
    if ((before.assignedTo?.id ?? null) !== (after.assignedTo?.id ?? null)) ownership.push(`${label}: assignedToId changed`);
    if (before.status !== after.status) ownership.push(`${label}: status changed ${before.status} -> ${after.status}`);

    const res = await call<{ message?: { content?: string } | null; suggestion?: { aiResponse?: string; executionId?: string } | null }>('POST', '/ai/test-chat', { message: cfg.question, clientMessageId: `ds-validate-${Date.now()}-${replies[label].length}` }, true);
    replies[label].push((res.message?.content ?? res.suggestion?.aiResponse ?? '').trim());

    const final = await call<{ assignedTo?: { id: string } | null }>('GET', `/conversations/${conversationId}`);
    if ((before.assignedTo?.id ?? null) !== (final.assignedTo?.id ?? null)) ownership.push(`${label}: assignedToId changed after the reply`);
    try {
      const executions = await call<{ items?: Array<{ toolTrace?: unknown }> }>('GET', `/ai/executions?conversationId=${encodeURIComponent(conversationId)}&limit=5`);
      tools[label]!.push(toolNames(executions.items?.[0]?.toolTrace));
    } catch { tools[label]!.push([]); }
  }

  for (let i = 0; i < cfg.runs; i++) {
    cfg.onProgress?.(`Run ${i + 1} of ${cfg.runs}...`);
    await ask('A', a.id);
    await ask('B', b.id);
  }
  await ask('none', null);
  if (c) await ask('insufficient', c.id);

  // ---- Checks
  add('Assigning a Digital Self never changed ownership, status or AI handling', ownership);
  const nonEmpty = (xs: string[]) => xs.length > 0 && xs.every((x) => x.length > 0);
  add('Every run produced a reply', nonEmpty(replies.A) && nonEmpty(replies.B) && nonEmpty(replies.none), 'a run returned nothing: check AI is enabled and the test allowance');

  for (const label of ['A', 'B', 'none', 'insufficient'] as const) {
    if (replies[label].length === 0) continue;
    const problems = replies[label].flatMap((r, i) => checkFacts(r, cfg.facts).map((p) => `run ${i + 1}: ${p}`));
    add(`Facts are correct and nothing is invented (${label === 'none' ? 'no Digital Self' : label === 'insufficient' ? 'too little learned' : `agent ${label}`})`, problems);
  }

  const [ma, mb] = [replies.A, replies.B].map((rs) => rs.map(measureReply).filter((m): m is StyleMetrics => !!m));
  const comparison = compareStyles(ma!, mb!);
  add('The two agents\' replies are distinguishable in style', comparison.distinguishable, `differing on: ${comparison.differing.join(', ') || 'nothing'}`);

  const [ta, tb] = [tools.A!.flat(), tools.B!.flat()];
  if (ta.length === 0 && tb.length === 0) skip('Both used the same tools and knowledge', 'the executions API returned no tool trace; compare in the AI Activity page');
  else add('Both used the same tools and knowledge', JSON.stringify([...new Set(ta)].sort()) === JSON.stringify([...new Set(tb)].sort()), `A used [${[...new Set(ta)].join(', ')}], B used [${[...new Set(tb)].join(', ')}]`);

  return { ok: checks.every((x) => x.status !== 'fail'), checks, replies };
}

export function formatReport(report: ValidationReport): string {
  const mark = { pass: 'PASS   ', fail: 'FAIL   ', skipped: 'SKIPPED' } as const;
  const lines = report.checks.map((c) => `${mark[c.status]} ${c.name}${c.detail ? `\n         ${c.detail}` : ''}`);
  return [...lines, '', report.ok ? 'RESULT: all checks passed (skipped checks need a manual look)' : 'RESULT: FAILED'].join('\n');
}
