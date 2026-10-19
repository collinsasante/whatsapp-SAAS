/** "m:ss" for a position or duration in seconds. Non-finite and negative values read as 0:00 (never "NaN:NaN"). */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Browsers cannot always tell the length of a voice note recorded in the browser (MediaRecorder writes WebM with
 * no duration, which <audio> reports as Infinity). Only a real, positive, finite length can drive a progress bar.
 */
export function usableDuration(duration: number | null | undefined): number | null {
  return duration != null && Number.isFinite(duration) && duration > 0 ? duration : null;
}

/** 0 to 100, safe for any input. */
export function progressPercent(current: number, duration: number | null): number {
  if (!duration || !Number.isFinite(current) || current <= 0) return 0;
  return Math.min(100, Math.max(0, (current / duration) * 100));
}

export const PLAYBACK_SPEEDS = [1, 1.5, 2] as const;
export function nextSpeed(current: number): number {
  const i = (PLAYBACK_SPEEDS as readonly number[]).indexOf(current);
  return PLAYBACK_SPEEDS[(i + 1) % PLAYBACK_SPEEDS.length] ?? 1;
}
