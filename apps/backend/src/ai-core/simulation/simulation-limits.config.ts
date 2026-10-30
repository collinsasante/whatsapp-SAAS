/**
 * Limits on SIMULATED AI traffic: the dashboard test tools (AI Test Chat, Commerce Test Chat, the AI sandbox), the commerce
 * evaluation harness, and the paid AI Learning judge when it grades a simulated reply. All of these call a real, paid model but
 * settle no customer credits, so without a limit a tenant user could generate unlimited provider cost.
 *
 * Every value is configurable. The defaults are PROPOSALS sized for a QA team exercising the bot by hand, not production
 * requirements: see docs/VERZCHAT_AI_IMPLEMENTATION_PROGRESS.md (5.4) for the rationale and the product decision still open.
 *
 * Sources, in order: built-in defaults, then env (AI_SIM_*), then a per-tenant override from AI_SIM_TENANT_OVERRIDES. Every value is
 * validated: a malformed or out-of-range value is IGNORED (the previous layer's value stays) and reported, never silently trusted.
 * A limit of 0 is allowed and means "none allowed" (the tool is switched off for that scope).
 */
export interface SimulationLimits {
  /** Simulated AI requests per tenant per UTC day, across all the test tools. */
  dailyRequests: number;
  /** Simulated AI requests per user per minute (shared across replicas, unlike the HTTP throttle). */
  userPerMinute: number;
  /** Longest customer message accepted by a test tool, in characters. */
  maxInputChars: number;
  /** Customer messages allowed in one test conversation before a new one must be started (bounds the history sent to the model). */
  maxConversationTurns: number;
  /** AI Learning judge evaluations of simulated replies per tenant per UTC day. */
  dailyEvaluations: number;
  /** Commerce evaluation runs (each ~15-20 scripted conversations) per tenant per UTC day. */
  dailyEvalRuns: number;
  /** How long a request id is remembered, so a retry replays the stored result instead of calling the provider again. */
  idempotencyTtlSeconds: number;
}

export const DEFAULT_SIMULATION_LIMITS: Readonly<SimulationLimits> = Object.freeze({
  dailyRequests: 200,
  userPerMinute: 5,
  maxInputChars: 1000,
  maxConversationTurns: 40,
  dailyEvaluations: 100,
  dailyEvalRuns: 3,
  idempotencyTtlSeconds: 900,
});

/** No configuration, env or per-tenant, can exceed these: a typo cannot turn the limit into "unlimited". */
export const SIMULATION_LIMIT_CEILINGS: Readonly<SimulationLimits> = Object.freeze({
  dailyRequests: 5000,
  userPerMinute: 60,
  maxInputChars: 4000, // the WhatsApp text maximum, and the DTO's own cap
  maxConversationTurns: 200,
  dailyEvaluations: 5000,
  dailyEvalRuns: 50,
  idempotencyTtlSeconds: 3600,
});

const FLOORS: Readonly<SimulationLimits> = Object.freeze({
  dailyRequests: 0, userPerMinute: 0, maxInputChars: 1, maxConversationTurns: 1, dailyEvaluations: 0, dailyEvalRuns: 0, idempotencyTtlSeconds: 60,
});

export const SIMULATION_ENV_KEYS: Readonly<Record<keyof SimulationLimits, string>> = Object.freeze({
  dailyRequests: 'AI_SIM_DAILY_REQUESTS',
  userPerMinute: 'AI_SIM_USER_PER_MINUTE',
  maxInputChars: 'AI_SIM_MAX_INPUT_CHARS',
  maxConversationTurns: 'AI_SIM_MAX_CONVERSATION_TURNS',
  dailyEvaluations: 'AI_SIM_DAILY_EVALUATIONS',
  dailyEvalRuns: 'AI_SIM_DAILY_EVAL_RUNS',
  idempotencyTtlSeconds: 'AI_SIM_IDEMPOTENCY_TTL_SECONDS',
});
export const SIMULATION_TENANT_OVERRIDES_KEY = 'AI_SIM_TENANT_OVERRIDES';

const LIMIT_NAMES = Object.keys(DEFAULT_SIMULATION_LIMITS) as Array<keyof SimulationLimits>;

/** A whole number within [floor, ceiling] for this limit, or null with a reason. */
export function validateLimit(name: keyof SimulationLimits, raw: unknown): { ok: true; value: number } | { ok: false; reason: string } {
  const n = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n)) return { ok: false, reason: 'must be a whole number' };
  if (n < FLOORS[name]) return { ok: false, reason: `must be at least ${FLOORS[name]}` };
  if (n > SIMULATION_LIMIT_CEILINGS[name]) return { ok: false, reason: `must be at most ${SIMULATION_LIMIT_CEILINGS[name]}` };
  return { ok: true, value: n };
}

export interface ParsedSimulationConfig {
  defaults: SimulationLimits;
  tenantOverrides: ReadonlyMap<string, Partial<SimulationLimits>>;
  /** Everything that was ignored and why. Values are never echoed back, only the setting's name. */
  warnings: string[];
}

export function parseSimulationConfig(get: (key: string) => string | undefined): ParsedSimulationConfig {
  const warnings: string[] = [];
  const defaults: SimulationLimits = { ...DEFAULT_SIMULATION_LIMITS };

  for (const name of LIMIT_NAMES) {
    const raw = get(SIMULATION_ENV_KEYS[name]);
    if (raw === undefined || raw.trim() === '') continue;
    const v = validateLimit(name, raw);
    if (v.ok) defaults[name] = v.value;
    else warnings.push(`${SIMULATION_ENV_KEYS[name]} ignored: ${v.reason}`);
  }

  const tenantOverrides = new Map<string, Partial<SimulationLimits>>();
  const rawOverrides = get(SIMULATION_TENANT_OVERRIDES_KEY);
  if (rawOverrides !== undefined && rawOverrides.trim() !== '') {
    let parsed: unknown;
    try { parsed = JSON.parse(rawOverrides); } catch { parsed = undefined; warnings.push(`${SIMULATION_TENANT_OVERRIDES_KEY} ignored: not valid JSON`); }
    if (parsed !== undefined && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
      warnings.push(`${SIMULATION_TENANT_OVERRIDES_KEY} ignored: must be an object keyed by tenant id`);
    } else if (parsed) {
      for (const [tenantId, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenantId) || value === null || typeof value !== 'object' || Array.isArray(value)) {
          warnings.push(`${SIMULATION_TENANT_OVERRIDES_KEY}: an entry was ignored (bad tenant id or value)`);
          continue;
        }
        const clean: Partial<SimulationLimits> = {};
        for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
          if (!LIMIT_NAMES.includes(name as keyof SimulationLimits)) { warnings.push(`${SIMULATION_TENANT_OVERRIDES_KEY}: unknown setting "${name.slice(0, 40)}" ignored`); continue; }
          const v = validateLimit(name as keyof SimulationLimits, raw);
          if (v.ok) clean[name as keyof SimulationLimits] = v.value;
          else warnings.push(`${SIMULATION_TENANT_OVERRIDES_KEY}: "${name}" ignored for one tenant: ${v.reason}`);
        }
        if (Object.keys(clean).length) tenantOverrides.set(tenantId, clean);
      }
    }
  }
  return { defaults, tenantOverrides, warnings };
}

export function resolveSimulationLimits(config: ParsedSimulationConfig, tenantId: string): SimulationLimits {
  return { ...config.defaults, ...(config.tenantOverrides.get(tenantId) ?? {}) };
}
