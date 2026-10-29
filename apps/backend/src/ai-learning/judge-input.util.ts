import { ResolvedInteractionContext } from './interaction-context.resolver';

/**
 * Limits on what is sent to the paid judge. They bound the cost of ONE call; they are proposals sized well above a normal
 * WhatsApp exchange (a text message is at most 4096 characters), not product requirements. Everything the judge reads is
 * customer- or model-written text, so it is also stripped of control characters and clearly marked when it was cut.
 */
export interface JudgeLimits { maxFieldChars: number; maxPriorMessageChars: number; maxPayloadChars: number }

export const JUDGE_LIMITS: Readonly<JudgeLimits> = Object.freeze({
  /** The customer message and the AI reply under evaluation: these are what is graded, so they get the most room. */
  maxFieldChars: 3000,
  /** One earlier turn, kept short on purpose: it is context, not the subject. */
  maxPriorMessageChars: 600,
  /** The whole serialized payload. Older context is dropped first, then the fields are cut further, so this always holds. */
  maxPayloadChars: 9000,
});

export const TRUNCATION_MARKER = ' [truncated]';

/** C0 controls (except tab and newline) and DEL. NUL and the like have no meaning in a chat message and can confuse downstream parsers. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export interface BoundedText { text: string; truncated: boolean }

export function boundText(value: string | null | undefined, max: number): BoundedText {
  const clean = (value ?? '').replace(CONTROL_CHARS, '');
  if (clean.length <= max) return { text: clean, truncated: false };
  // Cut on a code-point boundary so a surrogate pair is never split into an invalid string.
  const keep = Math.max(0, max - TRUNCATION_MARKER.length);
  let cut = clean.slice(0, keep);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return { text: cut + TRUNCATION_MARKER, truncated: true };
}

export interface JudgePayload {
  priorContext: Array<{ from: 'customer' | 'agent'; text: string }>;
  customerMessage: string;
  aiResponse: string;
  realBackendState: { latestOrderStatus: string | null; handoffTaskExists: boolean; conversationStatus: string };
  /** True when any text was shortened or earlier context was dropped, so the judge does not mistake a cut for the agent's mistake. */
  inputTruncated: boolean;
}

/** The judge's user message: bounded, cleaned, and always valid JSON. Never mutates the context it is given. */
export function buildJudgePayload(ctx: ResolvedInteractionContext, limits: Readonly<JudgeLimits> = JUDGE_LIMITS): { payload: JudgePayload; json: string } {
  let truncated = false;
  const field = (v: string | null | undefined, max: number): string => {
    const b = boundText(v, max);
    if (b.truncated) truncated = true;
    return b.text;
  };

  const customerMessage = field(ctx.customerMessage, limits.maxFieldChars);
  const aiResponse = field(ctx.aiResponse, limits.maxFieldChars);
  let prior = ctx.priorContext.map((m) => ({ from: (m.direction === 'INBOUND' ? 'customer' : 'agent') as 'customer' | 'agent', text: field(m.content, limits.maxPriorMessageChars) }));

  const build = (): { payload: JudgePayload; json: string } => {
    const payload: JudgePayload = {
      priorContext: prior,
      customerMessage,
      aiResponse,
      realBackendState: { latestOrderStatus: ctx.latestOrderStatus, handoffTaskExists: ctx.handoffTaskExists, conversationStatus: ctx.conversationStatus },
      inputTruncated: truncated,
    };
    return { payload, json: JSON.stringify(payload) };
  };

  let out = build();
  // Oldest context goes first: it matters least, and the turn being graded is never dropped.
  while (out.json.length > limits.maxPayloadChars && prior.length > 0) {
    prior = prior.slice(1);
    truncated = true;
    out = build();
  }
  if (out.json.length > limits.maxPayloadChars) {
    // Still over (only possible with tiny custom limits or very escape-heavy text): cut the two graded fields evenly. JSON escaping can
    // grow a character to six, so shrink in steps until it fits, with a floor so something is always left to grade.
    let each = Math.max(200, Math.floor(limits.maxPayloadChars / 6));
    for (;;) {
      const c = boundText(customerMessage, each);
      const a = boundText(aiResponse, each);
      truncated = true;
      const payload: JudgePayload = {
        priorContext: [],
        customerMessage: c.text,
        aiResponse: a.text,
        realBackendState: out.payload.realBackendState,
        inputTruncated: true,
      };
      const json = JSON.stringify(payload);
      if (json.length <= limits.maxPayloadChars || each <= 200) { out = { payload, json }; break; }
      each = Math.max(200, Math.floor(each * 0.7));
    }
  }
  return out;
}
