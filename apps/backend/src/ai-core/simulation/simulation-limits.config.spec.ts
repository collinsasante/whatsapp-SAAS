import {
  DEFAULT_SIMULATION_LIMITS, parseSimulationConfig, resolveSimulationLimits, SIMULATION_ENV_KEYS, SIMULATION_LIMIT_CEILINGS,
  SIMULATION_TENANT_OVERRIDES_KEY, validateLimit,
} from './simulation-limits.config';

const env = (vars: Record<string, string>) => (key: string) => vars[key];

describe('simulation limits configuration', () => {
  it('uses the documented defaults when nothing is configured', () => {
    const cfg = parseSimulationConfig(env({}));
    expect(cfg.defaults).toEqual(DEFAULT_SIMULATION_LIMITS);
    expect(cfg.warnings).toEqual([]);
    expect(resolveSimulationLimits(cfg, 'any-tenant')).toEqual(DEFAULT_SIMULATION_LIMITS);
  });

  it('every default is within its own ceiling, and no default is unlimited', () => {
    for (const [k, v] of Object.entries(DEFAULT_SIMULATION_LIMITS)) {
      expect(v).toBeLessThanOrEqual(SIMULATION_LIMIT_CEILINGS[k as keyof typeof SIMULATION_LIMIT_CEILINGS]);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('reads each limit from its environment variable', () => {
    const cfg = parseSimulationConfig(env({
      AI_SIM_DAILY_REQUESTS: '50', AI_SIM_USER_PER_MINUTE: '2', AI_SIM_MAX_INPUT_CHARS: '500', AI_SIM_MAX_CONVERSATION_TURNS: '10',
      AI_SIM_DAILY_EVALUATIONS: '20', AI_SIM_DAILY_EVAL_RUNS: '1', AI_SIM_IDEMPOTENCY_TTL_SECONDS: '300',
    }));
    expect(cfg.defaults).toEqual({ dailyRequests: 50, userPerMinute: 2, maxInputChars: 500, maxConversationTurns: 10, dailyEvaluations: 20, dailyEvalRuns: 1, idempotencyTtlSeconds: 300 });
    expect(cfg.warnings).toEqual([]);
  });

  it('0 is accepted where it makes sense and means none allowed', () => {
    expect(parseSimulationConfig(env({ AI_SIM_DAILY_REQUESTS: '0' })).defaults.dailyRequests).toBe(0);
    expect(parseSimulationConfig(env({ AI_SIM_DAILY_EVAL_RUNS: '0' })).defaults.dailyEvalRuns).toBe(0);
  });

  describe('a bad value is ignored (the default stays), reported by name only, and never echoed', () => {
    it.each([
      ['not a number', 'abc'], ['negative', '-5'], ['fraction', '1.5'], ['above the ceiling', '999999'], ['scientific', '1e9'], ['hex', '0x10'], ['with units', '50 per day'],
    ])('%s', (_l, raw) => {
      const cfg = parseSimulationConfig(env({ AI_SIM_DAILY_REQUESTS: raw }));
      expect(cfg.defaults.dailyRequests).toBe(DEFAULT_SIMULATION_LIMITS.dailyRequests);
      expect(cfg.warnings).toHaveLength(1);
      expect(cfg.warnings[0]).toContain('AI_SIM_DAILY_REQUESTS');
      expect(cfg.warnings[0]).not.toContain(raw);
    });

    it('limits that must be positive reject 0', () => {
      for (const key of ['AI_SIM_MAX_INPUT_CHARS', 'AI_SIM_MAX_CONVERSATION_TURNS']) {
        const cfg = parseSimulationConfig(env({ [key]: '0' }));
        expect(cfg.warnings).toHaveLength(1);
      }
    });

    it('a blank value is simply unset', () => {
      expect(parseSimulationConfig(env({ AI_SIM_DAILY_REQUESTS: '  ' })).warnings).toEqual([]);
    });
  });

  it('a typo can never raise a limit above its ceiling', () => {
    for (const name of Object.keys(SIMULATION_LIMIT_CEILINGS) as Array<keyof typeof SIMULATION_LIMIT_CEILINGS>) {
      expect(validateLimit(name, SIMULATION_LIMIT_CEILINGS[name]).ok).toBe(true);
      expect(validateLimit(name, SIMULATION_LIMIT_CEILINGS[name] + 1).ok).toBe(false);
    }
  });

  describe('per-tenant overrides', () => {
    const overrides = (o: unknown) => parseSimulationConfig(env({ [SIMULATION_TENANT_OVERRIDES_KEY]: JSON.stringify(o) }));

    it('apply to that tenant only, on top of the defaults', () => {
      const cfg = overrides({ 'tenant-a': { dailyRequests: 500, userPerMinute: 10 } });
      expect(resolveSimulationLimits(cfg, 'tenant-a')).toEqual({ ...DEFAULT_SIMULATION_LIMITS, dailyRequests: 500, userPerMinute: 10 });
      expect(resolveSimulationLimits(cfg, 'tenant-b')).toEqual(DEFAULT_SIMULATION_LIMITS);
    });

    it('layer over environment defaults', () => {
      const cfg = parseSimulationConfig(env({ AI_SIM_DAILY_REQUESTS: '50', [SIMULATION_TENANT_OVERRIDES_KEY]: JSON.stringify({ t1: { userPerMinute: 1 } }) }));
      expect(resolveSimulationLimits(cfg, 't1')).toMatchObject({ dailyRequests: 50, userPerMinute: 1 });
    });

    it('can switch a tenant off with 0', () => {
      expect(resolveSimulationLimits(overrides({ t1: { dailyRequests: 0 } }), 't1').dailyRequests).toBe(0);
    });

    it.each([
      ['malformed JSON', '{not json'], ['an array', '[]'], ['a string', '"x"'], ['null', 'null'],
    ])('%s is ignored as a whole', (_l, raw) => {
      const cfg = parseSimulationConfig(env({ [SIMULATION_TENANT_OVERRIDES_KEY]: raw }));
      expect(cfg.tenantOverrides.size).toBe(0);
      expect(cfg.warnings.length).toBeGreaterThan(0);
    });

    it('ignores a bad entry, a bad value and an unknown setting without dropping the good ones', () => {
      const cfg = overrides({ good: { dailyRequests: 10, bogusSetting: 5, userPerMinute: 99999 }, 'bad id!': { dailyRequests: 1 }, alsoBad: 7 });
      expect(resolveSimulationLimits(cfg, 'good')).toEqual({ ...DEFAULT_SIMULATION_LIMITS, dailyRequests: 10 });
      expect(cfg.tenantOverrides.has('bad id!')).toBe(false);
      expect(cfg.tenantOverrides.has('alsoBad')).toBe(false);
      expect(cfg.warnings.length).toBeGreaterThanOrEqual(4);
    });

    it('cannot exceed a ceiling even for one tenant', () => {
      const cfg = overrides({ t1: { dailyRequests: SIMULATION_LIMIT_CEILINGS.dailyRequests + 1 } });
      expect(resolveSimulationLimits(cfg, 't1').dailyRequests).toBe(DEFAULT_SIMULATION_LIMITS.dailyRequests);
    });

    it('an object key like __proto__ cannot smuggle in settings', () => {
      const cfg = parseSimulationConfig(env({ [SIMULATION_TENANT_OVERRIDES_KEY]: '{"__proto__":{"dailyRequests":5000}}' }));
      expect(resolveSimulationLimits(cfg, 'anyone').dailyRequests).toBe(DEFAULT_SIMULATION_LIMITS.dailyRequests);
      expect(({} as Record<string, unknown>).dailyRequests).toBeUndefined();
    });
  });

  it('exposes the environment variable name of every limit', () => {
    expect(Object.keys(SIMULATION_ENV_KEYS).sort()).toEqual(Object.keys(DEFAULT_SIMULATION_LIMITS).sort());
  });
});
