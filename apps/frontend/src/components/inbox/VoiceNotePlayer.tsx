'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatClock, nextSpeed, progressPercent, usableDuration } from '@/lib/audio-format';

// Only one voice note plays at a time: starting one pauses whichever was playing.
let currentlyPlaying: HTMLAudioElement | null = null;

interface Props {
  src: string;
  /** Own message (teal bubble) or the customer's (white bubble). */
  tone?: 'outbound' | 'inbound' | 'neutral';
  uploading?: boolean;
  uploadProgress?: number;
  className?: string;
}

export function VoiceNotePlayer({ src, tone = 'neutral', uploading = false, uploadProgress, className }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [speed, setSpeed] = useState(1);
  // Recorded WebM often reports Infinity: seek far past the end once so the browser works out the real length.
  const resolvingDuration = useRef(false);

  const onLoadedMetadata = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    const known = usableDuration(a.duration);
    if (known) { setDuration(known); return; }
    if (a.duration === Infinity && !resolvingDuration.current) {
      resolvingDuration.current = true;
      a.currentTime = 1e101;
    }
  }, []);

  const onTimeUpdate = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (resolvingDuration.current) {
      const known = usableDuration(a.duration);
      if (known) { setDuration(known); resolvingDuration.current = false; a.currentTime = 0; setCurrent(0); }
      return;
    }
    setCurrent(a.currentTime);
    if (duration == null) {
      const known = usableDuration(a.duration);
      if (known) setDuration(known);
    }
  }, [duration]);

  // The file can finish loading its metadata before React has attached the listeners above (server-rendered
  // markup starts loading immediately, and media events are not replayed). Read what the element already knows.
  useEffect(() => {
    const a = audioRef.current;
    if (a && a.readyState >= 1) onLoadedMetadata();
    if (a?.error) setFailed(true);
  }, [onLoadedMetadata]);

  useEffect(() => () => { if (currentlyPlaying === audioRef.current) currentlyPlaying = null; }, []);

  const toggle = async () => {
    const a = audioRef.current;
    if (!a || failed) return;
    if (!a.paused) { a.pause(); return; }
    if (currentlyPlaying && currentlyPlaying !== a) currentlyPlaying.pause();
    currentlyPlaying = a;
    setLoading(true);
    try {
      await a.play();
    } catch {
      // Autoplay policy blocks are not file errors; a real decode problem fires the element's error event instead.
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  };

  const seek = (percent: number) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    a.currentTime = (percent / 100) * duration;
    setCurrent(a.currentTime);
  };

  const cycleSpeed = () => {
    const next = nextSpeed(speed);
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const outbound = tone === 'outbound';
  const pct = progressPercent(current, duration);

  if (failed) {
    return (
      <div role="alert" className={cn('flex items-center gap-2 rounded-xl px-3 py-2 text-xs w-full max-w-[240px]', outbound ? 'bg-teal-800 text-white' : 'bg-gray-100 text-gray-700', className)}>
        <span className="flex-1 min-w-0">This voice note can&apos;t be played here.</span>
        <a href={src} download target="_blank" rel="noopener noreferrer" aria-label="Download voice note" className="flex-shrink-0 underline inline-flex items-center gap-1">
          <Download size={12} aria-hidden="true" /> Download
        </a>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-2 w-full max-w-[240px] min-w-[190px]', uploading && 'opacity-60', className)}>
      <button
        type="button"
        onClick={() => { void toggle(); }}
        disabled={uploading}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        className={cn(
          'w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-teal-500 disabled:cursor-not-allowed',
          outbound ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-teal-600 text-white hover:bg-teal-700',
        )}
      >
        {loading
          ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          : playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} className="ml-0.5" aria-hidden="true" />}
      </button>

      <div className="flex-1 min-w-0">
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={pct}
          disabled={!duration || uploading}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Voice note position"
          className={cn('block w-full h-1 cursor-pointer disabled:cursor-default', outbound ? 'accent-white' : 'accent-teal-600')}
        />
        <div className={cn('mt-1 flex items-center justify-between text-[11px] tabular-nums', outbound ? 'text-teal-100' : 'text-gray-500')}>
          <span>{uploading ? (uploadProgress ? `Uploading ${uploadProgress}%` : 'Uploading...') : playing || current > 0 ? formatClock(current) : formatClock(duration)}</span>
          {!uploading && duration != null && (playing || current > 0) && <span>{formatClock(duration)}</span>}
        </div>
      </div>

      {!uploading && (
        <button
          type="button"
          onClick={cycleSpeed}
          aria-label={`Playback speed ${speed}x. Change speed`}
          className={cn('flex-shrink-0 text-[11px] font-semibold rounded-full px-1.5 py-0.5 tabular-nums', outbound ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
        >
          {speed}x
        </button>
      )}

      {/* The element does the decoding; the controls above are the interface. */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onDurationChange={() => { const k = usableDuration(audioRef.current?.duration); if (k) setDuration(k); }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); if (audioRef.current) audioRef.current.currentTime = 0; }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
