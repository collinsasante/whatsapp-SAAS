import { describeRecorderError } from './voice-recorder';

export interface CallStartError {
  code: string;
  message: string;
  steps: string[];
  /** What Meta reported when asked (read-only), when we asked. */
  callingStatus?: { state: 'ENABLED' | 'DISABLED' | 'UNKNOWN'; checked: boolean };
}

const MIC_ERRORS = new Set(['NotAllowedError', 'SecurityError', 'NotFoundError', 'OverconstrainedError', 'NotReadableError', 'AbortError', 'NotSupportedError']);

/**
 * Turns whatever went wrong starting a call into one shape the UI can show. The server sends
 * { code, message, steps } for provider problems (see apps/backend calling-errors.util.ts); browser
 * microphone problems are named by their DOMException; anything else gets a generic message.
 */
export function parseCallStartError(err: unknown): CallStartError {
  const data = (err as { response?: { data?: Partial<CallStartError> & { message?: string | string[] } } })?.response?.data;
  if (data && typeof data === 'object' && typeof data.code === 'string') {
    const message = Array.isArray(data.message) ? data.message[0] : data.message;
    return {
      code: data.code,
      message: message || 'The call could not be placed.',
      steps: Array.isArray(data.steps) ? data.steps.filter((s): s is string => typeof s === 'string') : [],
      ...(data.callingStatus ? { callingStatus: data.callingStatus } : {}),
    };
  }
  const name = typeof err === 'object' && err && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (MIC_ERRORS.has(name)) return { code: 'MICROPHONE', message: describeRecorderError(err), steps: [] };
  const plain = typeof data?.message === 'string' ? data.message : Array.isArray(data?.message) ? data.message[0] : '';
  return { code: 'UNKNOWN', message: plain || 'The call could not be placed. Please try again.', steps: [] };
}

export interface CallResources {
  pc?: { close: () => void } | null;
  stream?: { getTracks: () => Array<{ stop: () => void }> } | null;
  remoteAudio?: { pause?: () => void; srcObject?: unknown; remove: () => void } | null;
}

/**
 * Releases everything a call attempt opened. Safe to call twice and with partial resources. Without this a
 * failed call start left the microphone live, the peer connection open and an <audio> element in the page.
 */
export function releaseCallResources(r: CallResources): void {
  for (const step of [
    () => r.stream?.getTracks().forEach((t) => t.stop()),
    () => r.pc?.close(),
    () => { if (r.remoteAudio) { r.remoteAudio.pause?.(); r.remoteAudio.srcObject = null; r.remoteAudio.remove(); } },
  ]) {
    try { step(); } catch { /* releasing must never throw: the user has already seen the real error */ }
  }
}
