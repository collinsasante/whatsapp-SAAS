/**
 * Voice-note recording helpers. Chrome and Firefox record WebM/Opus; Safari cannot record WebM at all and
 * records MP4/AAC. The old code hard-coded WebM, so on Safari `new MediaRecorder(...)` threw and the failure
 * was reported as "Microphone access denied".
 */
const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'] as const;

/** First recorder type the browser supports, or undefined to let the browser choose its own default. */
export function pickRecorderMime(isTypeSupported: (type: string) => boolean): string | undefined {
  return CANDIDATES.find((type) => {
    try { return isTypeSupported(type); } catch { return false; }
  });
}

export function voiceFileName(mimeType: string): string {
  const bare = mimeType.split(';')[0]?.trim().toLowerCase();
  if (bare === 'audio/webm') return 'voice-note.webm';
  if (bare === 'audio/ogg') return 'voice-note.ogg';
  if (bare === 'audio/mp4') return 'voice-note.m4a';
  return 'voice-note.webm';
}

/** A message that says what actually went wrong, instead of one catch-all. */
export function describeRecorderError(err: unknown): string {
  const name = typeof err === 'object' && err && 'name' in err ? String((err as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access is blocked. Allow it in your browser settings and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Connect one and try again.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Your microphone is in use by another app. Close it and try again.';
    case 'NotSupportedError':
      return 'This browser cannot record voice notes. Try Chrome, Edge, Firefox or Safari.';
    default:
      return 'Could not start recording. Please try again.';
  }
}
