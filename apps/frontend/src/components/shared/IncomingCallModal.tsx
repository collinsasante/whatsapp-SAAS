'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Phone, PhoneOff, Mic, MicOff, PhoneIncoming } from 'lucide-react';
import toast from 'react-hot-toast';
import { callsApi } from '@/lib/api';
import { useCallsStore } from '@/store/calls.store';
import { useCallRecording, uploadCallRecording } from '@/hooks/useCallRecording';
import { cn } from '@/lib/utils';

type CallState = 'ringing' | 'connecting' | 'active' | 'declined' | 'ended';

function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return elapsed;
}

function formatElapsed(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function playRingTone(ctx: AudioContext) {
  const playBeep = (time: number, freq: number, dur: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.start(time);
    osc.stop(time + dur);
  };
  const t = ctx.currentTime;
  playBeep(t, 440, 0.12);
  playBeep(t + 0.15, 550, 0.12);
  playBeep(t + 0.30, 440, 0.12);
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '??';
}

export function IncomingCallModal() {
  const { incomingCall, setIncomingCall } = useCallsStore();
  const [state, setState] = useState<CallState>('ringing');
  const [muted, setMuted] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const pcRef           = useRef<RTCPeerConnection | null>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef  = useRef<HTMLAudioElement | null>(null);
  const ringCtxRef      = useRef<AudioContext | null>(null);
  const ringTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  // Kept to upload recording when call ends remotely (incomingCall cleared from store)
  const recordingCallIdRef = useRef<string | null>(null);

  // Destructure so useCallback deps are stable (useCallRecording uses useCallback internally)
  const { start: startRecording, stop: stopRecording, isRecording } = useCallRecording();
  const elapsed = useElapsedSeconds(state === 'active');

  // ── Stop recording and upload (fire-and-forget) ───────────────────────────
  const stopAndUpload = useCallback(() => {
    const id = recordingCallIdRef.current;
    if (!id) return;
    recordingCallIdRef.current = null;
    void stopRecording().then((blob) => {
      if (blob) void uploadCallRecording(id, blob);
    });
  }, [stopRecording]);

  // ── Clean up audio/WebRTC resources ──────────────────────────────────────
  const cleanup = useCallback(() => {
    stopAndUpload();
    if (ringTimerRef.current) { clearInterval(ringTimerRef.current); ringTimerRef.current = null; }
    if (ringCtxRef.current) {
      try { ringCtxRef.current.close(); } catch { /* ignore */ }
      ringCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    remoteStreamRef.current = null;
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
  }, [stopAndUpload]);

  // ── Auto-dismiss after showing final state ────────────────────────────────
  const autoDismiss = useCallback((delay = 2500) => {
    setTimeout(() => {
      setDismissing(true);
      setTimeout(() => { setIncomingCall(null); setDismissing(false); }, 300);
    }, delay);
  }, [setIncomingCall]);

  // ── Start ringtone when a new call arrives ────────────────────────────────
  useEffect(() => {
    if (!incomingCall) return;
    setState('ringing');
    setMuted(false);
    setDismissing(false);

    try {
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      ringCtxRef.current = ctx;
      playRingTone(ctx);
      ringTimerRef.current = setInterval(() => playRingTone(ctx), 2500);
    } catch { /* audio may be blocked — silently continue */ }

    return cleanup;
  }, [incomingCall, cleanup]);

  // ── Handle remote call termination (store cleared externally) ─────────────
  useEffect(() => {
    if (!incomingCall && isRecording()) {
      stopAndUpload();
    }
  }, [incomingCall]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Decline: agent pressed decline ───────────────────────────────────────
  const handleDecline = useCallback(async () => {
    if (!incomingCall) return;
    cleanup();
    try { await callsApi.respond(incomingCall.callLogId, 'reject'); } catch { /* best-effort */ }
    setState('declined');
    autoDismiss(1500);
  }, [incomingCall, cleanup, autoDismiss]);

  // ── Accept: agent pressed accept ─────────────────────────────────────────
  const handleAccept = useCallback(async () => {
    if (!incomingCall) return;

    // Stop ringtone immediately
    if (ringTimerRef.current) { clearInterval(ringTimerRef.current); ringTimerRef.current = null; }
    if (ringCtxRef.current) {
      try { ringCtxRef.current.close(); } catch { /* ignore */ }
      ringCtxRef.current = null;
    }

    setState('connecting');
    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });
      pcRef.current = pc;

      // Bail out helper: caller may hang up while we await getUserMedia / ICE
      const aborted = () => pc.signalingState === 'closed';

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (aborted()) { stream.getTracks().forEach(t => t.stop()); return; }

      streamRef.current = stream;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // Remote audio element
      pc.ontrack = (event) => {
        if (!remoteAudioRef.current) return;
        const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
        remoteStreamRef.current = remoteStream;
        remoteAudioRef.current.srcObject = remoteStream;
        void remoteAudioRef.current.play().catch(() => {
          const retry = () => { void remoteAudioRef.current?.play().catch(() => {}); document.removeEventListener('click', retry); };
          document.addEventListener('click', retry, { once: true });
        });
      };

      if (incomingCall.sdpOffer) {
        await pc.setRemoteDescription({ type: 'offer', sdp: incomingCall.sdpOffer });
        if (aborted()) return;
      }

      const answer = await pc.createAnswer();
      if (aborted()) return;
      await pc.setLocalDescription(answer);

      // Wait for ICE gathering (max 4s)
      if (pc.iceGatheringState !== 'complete') {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 4000);
          pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
          });
        });
      }
      if (aborted()) return;

      // Meta requires a=setup:active in the SDP answer (not actpass)
      const rawSdp = pc.localDescription!.sdp;
      const sdpAnswer = rawSdp.replace(/a=setup:actpass/g, 'a=setup:active');

      await callsApi.respond(incomingCall.callLogId, 'pre_accept', sdpAnswer);
      if (aborted()) return;

      // Wait for ICE connection (max 15s)
      await new Promise<void>((resolve) => {
        const check = () => {
          const s = pc.iceConnectionState;
          if (s === 'connected' || s === 'completed' || s === 'failed') {
            clearTimeout(timer); resolve();
          }
        };
        const timer = setTimeout(() => { pc.oniceconnectionstatechange = null; resolve(); }, 15000);
        pc.oniceconnectionstatechange = check;
        check();
      });
      if (aborted()) return;

      try { await callsApi.respond(incomingCall.callLogId, 'accept'); } catch { /* best-effort */ }

      setState('active');
      // Start recording once both local + remote streams are available
      recordingCallIdRef.current = incomingCall.callLogId;
      startRecording(streamRef.current, remoteStreamRef.current);
    } catch (err) {
      console.error('[IncomingCallModal] WebRTC accept failed:', err);
      toast.error('Could not connect call — microphone may be blocked');
      cleanup();
      try { await callsApi.respond(incomingCall.callLogId, 'reject'); } catch { /* ignore */ }
      setState('declined');
      autoDismiss(1500);
    }
  }, [incomingCall, cleanup, autoDismiss, startRecording]);

  // ── Hang up during active call ────────────────────────────────────────────
  const handleHangup = useCallback(async () => {
    if (!incomingCall) return;
    stopAndUpload();
    cleanup();
    try { await callsApi.respond(incomingCall.callLogId, 'terminate'); } catch { /* best-effort */ }
    setState('ended');
    autoDismiss(2000);
  }, [incomingCall, cleanup, stopAndUpload, autoDismiss]);

  // ── Toggle mute ───────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!streamRef.current) return;
    const track = streamRef.current.getAudioTracks()[0];
    if (track) {
      track.enabled = muted; // if currently muted, re-enable
      setMuted(m => !m);
    }
  }, [muted]);

  if (!incomingCall) return null;

  const displayName = incomingCall.contactName ?? incomingCall.from;
  const initials = getInitials(displayName);

  const headerBg =
    state === 'ringing'    ? 'from-emerald-600 to-emerald-500' :
    state === 'connecting' ? 'from-teal-700 to-teal-600' :
    state === 'active'     ? 'from-teal-800 to-teal-700' :
    state === 'declined'   ? 'from-red-700 to-red-600' :
                             'from-gray-700 to-gray-600';

  return (
    <>
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
      <div className={cn(
        'fixed top-4 right-4 z-50 w-80 transition-all duration-300',
        dismissing ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0',
        'animate-in slide-in-from-right-4 fade-in duration-300',
      )}>
        <div className={cn(
          'bg-white rounded-2xl shadow-2xl border overflow-hidden',
          state === 'ringing' ? 'border-emerald-200' :
          state === 'declined' ? 'border-red-200' :
          'border-gray-200',
        )}>
          {/* Header strip */}
          <div className={cn('px-4 py-3 flex items-center gap-3 bg-gradient-to-r', headerBg)}>
            <div className="relative flex-shrink-0">
              {state === 'ringing' && (
                <>
                  <span className="absolute inset-0 rounded-full bg-white/30 animate-ping" />
                  <span className="absolute inset-0 rounded-full bg-white/20 animate-ping" style={{ animationDelay: '0.5s' }} />
                </>
              )}
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-bold relative z-10">
                {initials}
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-white/70 text-[10px] font-semibold uppercase tracking-widest leading-none mb-0.5">
                {state === 'ringing'    ? 'Incoming call' :
                 state === 'connecting' ? 'Connecting…'   :
                 state === 'active'     ? 'On call'        :
                 state === 'declined'   ? 'Call declined'  :
                                          'Call ended'}
              </p>
              <p className="text-white font-bold text-sm truncate">{displayName}</p>
              {incomingCall.contactName && (
                <p className="text-white/60 text-xs truncate">{incomingCall.from}</p>
              )}
            </div>

            {state === 'active' && (
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-white/90 text-sm font-mono tabular-nums">
                  {formatElapsed(elapsed)}
                </span>
                <span className="flex items-center gap-1 text-red-300 text-[10px] font-semibold">
                  <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
                  REC
                </span>
              </div>
            )}
            {state === 'ringing' && (
              <div className="flex-shrink-0">
                <PhoneIncoming size={16} className="text-white/80 animate-bounce" />
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="px-4 py-3 bg-white">
            {state === 'ringing' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { void handleDecline(); }}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-600 text-sm font-semibold transition-colors border border-red-100"
                >
                  <PhoneOff size={15} /> Decline
                </button>
                <button
                  onClick={() => { void handleAccept(); }}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-700 text-sm font-semibold transition-colors border border-emerald-100"
                >
                  <Phone size={15} /> Accept
                </button>
              </div>
            )}

            {state === 'connecting' && (
              <div className="flex items-center justify-center gap-2 py-1.5">
                <span className="w-4 h-4 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin flex-shrink-0" />
                <span className="text-sm text-gray-500">Setting up audio…</span>
              </div>
            )}

            {state === 'active' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleMute}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors border',
                    muted
                      ? 'bg-red-50 hover:bg-red-100 text-red-600 border-red-100'
                      : 'bg-gray-50 hover:bg-gray-100 text-gray-600 border-gray-100',
                  )}
                >
                  {muted ? <MicOff size={15} /> : <Mic size={15} />}
                  {muted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  onClick={() => { void handleHangup(); }}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-600 text-sm font-semibold transition-colors border border-red-100"
                >
                  <PhoneOff size={15} /> Hang up
                </button>
              </div>
            )}

            {(state === 'declined' || state === 'ended') && (
              <div className="flex items-center justify-center gap-2 py-1.5 text-sm text-gray-500">
                {state === 'declined' ? '🚫 Call declined' : '📵 Call ended'}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
