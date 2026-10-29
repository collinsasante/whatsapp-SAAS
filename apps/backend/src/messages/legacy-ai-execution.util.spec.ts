import { DEEPSEEK_MODEL } from '../common/deepseek';
import { buildLegacyTrace, describeProviderError, readProviderUsage } from './legacy-ai-execution.util';

describe('readProviderUsage', () => {
  it('returns the provider\'s own token counts', () => {
    expect(readProviderUsage({ data: { usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } } })).toEqual({ inputTokens: 120, outputTokens: 30 });
  });

  it.each<[string, unknown]>([
    ['no response', undefined], ['no data', {}], ['no usage', { data: {} }], ['an empty usage block', { data: { usage: {} } }],
    ['a null usage', { data: { usage: null } }],
  ])('never invents a number when there is %s', (_l, response) => {
    expect(readProviderUsage(response)).toEqual({ inputTokens: undefined, outputTokens: undefined });
  });

  it.each<[string, unknown]>([['a string', '120'], ['a negative', -1], ['a fraction', 1.5], ['NaN', NaN], ['an object', {}], ['null', null]])(
    'ignores a malformed count (%s) instead of recording it', (_l, bad) => {
      expect(readProviderUsage({ data: { usage: { prompt_tokens: bad, completion_tokens: 7 } } })).toEqual({ inputTokens: undefined, outputTokens: 7 });
    });

  it('keeps zero, which is a real count', () => {
    expect(readProviderUsage({ data: { usage: { prompt_tokens: 0, completion_tokens: 0 } } })).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe('describeProviderError', () => {
  it('reports an HTTP status without the body, headers or request config', () => {
    const err = Object.assign(new Error('Request failed'), { response: { status: 401, data: { error: 'Authentication Fails, key sk-secret-value' } }, config: { headers: { Authorization: 'Bearer sk-secret-value' } } });
    const d = describeProviderError(err);
    expect(d).toEqual({ code: 'http_401', message: 'Provider answered HTTP 401' });
    expect(JSON.stringify(d)).not.toContain('sk-secret-value');
  });

  it('reports a network code in lower case', () => {
    expect(describeProviderError(Object.assign(new Error('x'), { code: 'ECONNABORTED' }))).toEqual({ code: 'econnaborted', message: 'Provider request failed (ECONNABORTED)' });
  });

  it.each<[string, unknown]>([['a plain error', new Error('boom')], ['a string', 'boom'], ['null', null], ['an odd code', { code: 'not a code!' }]])(
    'falls back to a generic description for %s, never echoing it', (_l, err) => {
      expect(describeProviderError(err)).toEqual({ code: 'network', message: 'Provider request failed' });
    });
});

describe('buildLegacyTrace', () => {
  const answered = { invoked: true, usage: { inputTokens: 120, outputTokens: 30 } };

  it('SUCCESS carries only the provider\'s real tokens, the real latency and the confidence, and no invented cost', () => {
    const t = buildLegacyTrace({ legacy: { response: 'Hi there', confidence: 80 }, call: answered, latencyMs: 412 });
    expect(t).toMatchObject({ status: 'SUCCESS', provider: 'deepseek', modelKey: DEEPSEEK_MODEL, latencyMs: 412, inputTokens: 120, outputTokens: 30, confidence: 80 });
    expect(t.estCostUsd).toBeUndefined();
    expect(t.errorCode).toBeUndefined();
  });

  it('SUCCESS without a usage block has no token numbers (not zero)', () => {
    const t = buildLegacyTrace({ legacy: { response: 'Hi', confidence: null }, call: { invoked: true }, latencyMs: 5 });
    expect(t.status).toBe('SUCCESS');
    expect(t.inputTokens).toBeUndefined();
    expect(t.outputTokens).toBeUndefined();
    expect(t.confidence).toBeNull();
  });

  it('a provider error is PROVIDER_ERROR with the safe code, and no tokens', () => {
    const t = buildLegacyTrace({ legacy: { response: '', confidence: null }, call: { invoked: true, error: { code: 'http_401', message: 'Provider answered HTTP 401' } }, latencyMs: 90 });
    expect(t).toMatchObject({ status: 'PROVIDER_ERROR', provider: 'deepseek', errorCode: 'http_401', errorMessage: 'Provider answered HTTP 401', latencyMs: 90 });
    expect(t.inputTokens).toBeUndefined();
  });

  it('an answered call whose output was dropped is EMPTY, keeps the real tokens, and says why', () => {
    const t = buildLegacyTrace({ legacy: { response: '', confidence: null }, call: answered, latencyMs: 300 });
    expect(t).toMatchObject({ status: 'EMPTY', errorCode: 'output_rejected', inputTokens: 120, outputTokens: 30, safetyFlags: { emptyOutput: true } });
  });

  it('an injection block is BLOCKED and flagged, with no provider details', () => {
    const t = buildLegacyTrace({ legacy: { response: 'I am here to help.', confidence: 100, blocked: true }, call: { invoked: false }, latencyMs: 2 });
    expect(t).toMatchObject({ status: 'BLOCKED', safetyFlags: { injectionDetected: true } });
    expect(t.provider).toBeUndefined();
  });

  it('no provider call and no block (no API key) is a PROVIDER_ERROR, not a success', () => {
    const t = buildLegacyTrace({ legacy: { response: '', confidence: null }, call: { invoked: false }, latencyMs: 1 });
    expect(t).toMatchObject({ status: 'PROVIDER_ERROR', errorCode: 'not_configured' });
    expect(t.provider).toBeUndefined();
  });

  it('tags every kind of trace as simulated when asked, and none otherwise', () => {
    const cases = [
      { legacy: { response: 'Hi', confidence: 80 }, call: { invoked: true } },
      { legacy: { response: '' }, call: { invoked: true } },
      { legacy: { response: '' }, call: { invoked: true, error: { code: 'http_401', message: 'x' } } },
      { legacy: { response: 'x', blocked: true }, call: { invoked: false } },
      { legacy: { response: '' }, call: { invoked: false } },
    ];
    for (const c of cases) {
      expect(buildLegacyTrace({ ...c, latencyMs: 1, simulated: true }).safetyFlags.simulated).toBe(true);
      expect(buildLegacyTrace({ ...c, latencyMs: 1 }).safetyFlags.simulated).toBeUndefined();
    }
  });

  it('never reports SUCCESS for an empty response', () => {
    for (const call of [{ invoked: false }, { invoked: true }, { invoked: true, error: { code: 'x', message: 'y' } }]) {
      expect(buildLegacyTrace({ legacy: { response: '' }, call, latencyMs: 1 }).status).not.toBe('SUCCESS');
    }
  });
});
