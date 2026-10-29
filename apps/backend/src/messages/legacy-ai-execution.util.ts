import { DEEPSEEK_MODEL } from '../common/deepseek';
import { PipelineTrace } from '../ai-core/pipeline/pipeline.types';

/**
 * What the legacy responder's provider call looked like, collected by MessagesService while the responder runs. The responder
 * itself is untouched; everything here comes from the provider's actual answer or error, nothing is estimated.
 */
export interface LegacyCallObservation {
  invoked: boolean;
  usage?: { inputTokens?: number; outputTokens?: number };
  error?: { code: string; message: string };
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Token usage exactly as the provider reported it. A missing or malformed block yields no numbers, never a guess. */
export function readProviderUsage(response: unknown): { inputTokens?: number; outputTokens?: number } {
  const usage = (response as { data?: { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } } | null | undefined)?.data?.usage;
  return {
    inputTokens: isCount(usage?.prompt_tokens) ? usage.prompt_tokens : undefined,
    outputTokens: isCount(usage?.completion_tokens) ? usage.completion_tokens : undefined,
  };
}

/** A short, safe description of a provider failure: the HTTP status or network code only, never the response body or headers. */
export function describeProviderError(err: unknown): { code: string; message: string } {
  const status = (err as { response?: { status?: unknown } } | null | undefined)?.response?.status;
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof status === 'number') return { code: `http_${status}`, message: `Provider answered HTTP ${status}` };
  if (typeof code === 'string' && /^[A-Z_]{3,32}$/.test(code)) return { code: code.toLowerCase(), message: `Provider request failed (${code})` };
  return { code: 'network', message: 'Provider request failed' };
}

/**
 * The execution record for one legacy-responder turn. Honest by construction: a status is only SUCCESS when the provider
 * answered and a clean reply came out; tokens are only the provider's own numbers; no cost is invented.
 */
export function buildLegacyTrace(args: {
  legacy: { response?: string; confidence?: number | null; blocked?: boolean };
  call: LegacyCallObservation;
  latencyMs: number;
}): PipelineTrace {
  const { legacy, call, latencyMs } = args;
  const base = { latencyMs, confidence: legacy.confidence ?? null, stageTimings: {} as Record<string, number> };

  if (legacy.blocked) {
    return { ...base, status: 'BLOCKED', safetyFlags: { injectionDetected: true } };
  }
  if (!call.invoked) {
    // No provider call was made and nothing was blocked: the responder returned early (for example, no API key).
    return { ...base, status: 'PROVIDER_ERROR', safetyFlags: {}, errorCode: 'not_configured', errorMessage: 'No provider call was made' };
  }
  const provider = { provider: 'deepseek', modelKey: DEEPSEEK_MODEL };
  if (call.error) {
    return { ...base, ...provider, status: 'PROVIDER_ERROR', safetyFlags: {}, errorCode: call.error.code, errorMessage: call.error.message };
  }
  const tokens = { inputTokens: call.usage?.inputTokens, outputTokens: call.usage?.outputTokens };
  if (!legacy.response) {
    // The provider answered but nothing usable came out (cut-off or malformed output is dropped by the responder).
    return { ...base, ...provider, ...tokens, status: 'EMPTY', safetyFlags: { emptyOutput: true }, errorCode: 'output_rejected', errorMessage: 'The provider answered but no usable reply came out' };
  }
  return { ...base, ...provider, ...tokens, status: 'SUCCESS', safetyFlags: {} };
}
