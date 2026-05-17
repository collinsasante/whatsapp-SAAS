'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { PhoneCall, PhoneOff, Mic, MicOff, Pause, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { callsApi } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useCallsStore } from '@/store/calls.store';
import { useCallRecording, uploadCallRecording } from '@/hooks/useCallRecording';
import { cn } from '@/lib/utils';

function WaveformBars() {
  return (
    <div className="flex items-center gap-0.5 h-5">
      {[3, 6, 9, 6, 4, 8, 5, 7, 3, 6].map((h, i) => (
        <div key={i} className="w-0.5 bg-emerald-400 rounded-full animate-pulse"
          style={{ height: `${h * 2}px`, animationDelay: `${i * 80}ms`, animationDuration: `${600 + i * 50}ms` }} />
      ))}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `00:${String(seconds).padStart(2, '0')}`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Terminal statuses that should automatically close the bar */
const TERMINAL = new Set([
  'ENDED', 'MISSED', 'DECLINED', 'CANCELED', 'UNANSWERED', 'BUSY', 'FAILED',
  // legacy values kept for safety
  'COMPLETED', 'CANCELLED',
]);

/** Labels and colours for each lifecycle phase */
type Phase = 'initiating' | 'ringing' | 'connected' | 'held' | 'declined' | 'unanswered' | 'canceled' | 'ended';

function phaseOf(call: ReturnType<typeof useCallsStore.getState>['outboundCall']): Phase {
  if (!call) return 'initiating';
  if (call.endedReason === 'declined')   return 'declined';
  if (call.endedReason === 'unanswered') return 'unanswered';
  if (call.endedReason === 'canceled')   return 'canceled';
  if (call.endedReason === 'ended')      return 'ended';
  if (call.held)                         return 'held';
  if (call.startedAt)                    return 'connected';
  if (call.ringing)                      return 'ringing';
  return 'initiating';
}

const LOG = (...args: unknown[]) => console.log('[OutboundCallBar]', ...args);

const PHASE_LABEL: Record<Phase, string> = {
  initiating:  'Calling…',
  ringing:     'Ringing…',
  connected:   '',        // shows timer
  held:        'On Hold',
  declined:    'Declined',
  unanswered:  'No answer',
  canceled:    'Canceled',
  ended:       'Call ended',
};

export function OutboundCallBar() {
  const { outboundCall, setOutboundCall, outboundSession, setOutboundSession } = useCallsStore();
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [togglingMute, setTogglingMute] = useState(false);
  const [togglingHold, setTogglingHold] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const barRef    = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  // Destructure so useCallback deps are stable (useCallRecording uses useCallback internally)
  const { start: startRecording, stop: stopRecording } = useCallRecording();
  const recordingStartedRef = useRef(false); // guard against double-start

  const phase = phaseOf(outboundCall);
  const connected = phase === 'connected';
  const terminal  = ['declined', 'unanswered', 'canceled', 'ended'].includes(phase);

  // trace every render so we can see state driving the UI
  LOG(`render | phase=${phase} connected=${connected} startedAt=${outboundCall?.startedAt ?? null} ringing=${outboundCall?.ringing} callId=${outboundCall?.callId}`);

  // ── Elapsed timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!connected) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [connected]);

  useEffect(() => {
    if (outboundCall) { setElapsed(0); setMuted(false); recordingStartedRef.current = false; }
  }, [outboundCall?.callId]); // eslint-disable-line react-hooks/exhaustive-deps

  // NOTE: do NOT use WebRTC `connectionState === 'connected'` to start the timer.
  // With the WhatsApp Calling API, ICE/DTLS establishes against Meta's media
  // gateway during the *ringing* phase — well before the customer picks up — so
  // the peer connection reports 'connected' too early. The timer is driven only
  // by the `call_accepted` socket event below, which the backend emits when Meta
  // sends the real `accept` webhook (customer actually answered).

  // ── Start recording when customer answers ──────────────────────────────────
  useEffect(() => {
    if (!connected || recordingStartedRef.current) return;
    const session = useCallsStore.getState().outboundSession;
    if (!session) return;
    recordingStartedRef.current = true;
    const remoteStream = session.remoteAudio.srcObject instanceof MediaStream
      ? session.remoteAudio.srcObject
      : null;
    startRecording(session.stream, remoteStream);
  }, [connected, outboundSession, startRecording]);

  // ── Stop recording when call reaches a terminal phase ─────────────────────
  const recordingCallIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (outboundCall?.callId) recordingCallIdRef.current = outboundCall.callId;
  }, [outboundCall?.callId]);

  const stopAndUpload = useCallback(() => {
    const id = recordingCallIdRef.current;
    if (!id) return;
    recordingCallIdRef.current = null;
    recordingStartedRef.current = false;
    void stopRecording().then((blob) => {
      if (blob) void uploadCallRecording(id, blob);
    });
  }, [stopRecording]);

  // ── Cleanup WebRTC session ─────────────────────────────────────────────────
  const cleanupSession = useCallback(() => {
    const session = useCallsStore.getState().outboundSession;
    if (!session) return;
    try { session.pc.close(); } catch { /* ignore */ }
    session.stream.getTracks().forEach(t => t.stop());
    try { session.remoteAudio.srcObject = null; session.remoteAudio.remove(); } catch { /* ignore */ }
    setOutboundSession(null);
  }, [setOutboundSession]);

  // ── Dismiss bar (with fade animation) ─────────────────────────────────────
  const dismiss = useCallback((delay = 0) => {
    setTimeout(() => {
      setDismissing(true);
      setTimeout(() => {
        setOutboundCall(null);
        setDismissing(false);
      }, 300);
    }, delay);
  }, [setOutboundCall]);

  // ── Socket listeners ───────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    LOG('socket handlers registered');

    const onRinging = (data: { call: { callLogId: string } }) => {
      LOG('call_ringing received', JSON.stringify(data));
      const current = useCallsStore.getState().outboundCall;
      LOG('call_ringing | current.callId=', current?.callId, '| event callLogId=', data.call?.callLogId);
      if (!current || current.callId !== data.call?.callLogId) {
        LOG('call_ringing IGNORED — id mismatch or no active call');
        return;
      }
      LOG('call_ringing → setting ringing=true');
      setOutboundCall({ ...current, ringing: true });
    };

    const onAccepted = (data: { callLogId: string }) => {
      LOG('call_accepted received', JSON.stringify(data));
      const current = useCallsStore.getState().outboundCall;
      const id = (data as unknown as { call?: { callLogId?: string } }).call?.callLogId ?? data.callLogId;
      LOG('call_accepted | current.callId=', current?.callId, '| resolved id=', id);
      if (!current || current.callId !== id) {
        LOG('call_accepted IGNORED — id mismatch or no active call');
        return;
      }
      if (!current.startedAt) {
        LOG('call_accepted → setting startedAt (timer start)');
        setOutboundCall({ ...current, startedAt: new Date() });
      } else {
        LOG('call_accepted — startedAt already set, skipping');
      }
    };

    const onConnected = (data: { callLogId?: string; call?: { callLogId: string } }) => {
      LOG('call_connected received', JSON.stringify(data));
      const current = useCallsStore.getState().outboundCall;
      const id = data.callLogId ?? data.call?.callLogId;
      LOG('call_connected | current.callId=', current?.callId, '| resolved id=', id);
      if (!current || current.callId !== id) {
        LOG('call_connected IGNORED — id mismatch or no active call');
        return;
      }
      if (!current.startedAt) {
        LOG('call_connected → setting startedAt (timer start)');
        setOutboundCall({ ...current, startedAt: new Date() });
      } else {
        LOG('call_connected — startedAt already set, skipping');
      }
    };

    const onDeclined = (data: { call: { id: string } }) => {
      LOG('call_declined received', JSON.stringify(data));
      const current = useCallsStore.getState().outboundCall;
      if (!current || current.callId !== data.call?.id) { LOG('call_declined IGNORED'); return; }
      LOG('call_declined → ending call');
      stopAndUpload();
      cleanupSession();
      setOutboundCall({ ...current, endedReason: 'declined' });
      toast.error('Call declined', { icon: '🚫' });
      dismiss(2000);
    };

    const onUnanswered = (data: { call: { id: string } }) => {
      LOG('call_unanswered received', JSON.stringify(data));
      const current = useCallsStore.getState().outboundCall;
      if (!current || current.callId !== data.call?.id) { LOG('call_unanswered IGNORED'); return; }
      LOG('call_unanswered → ending call');
      stopAndUpload();
      cleanupSession();
      setOutboundCall({ ...current, endedReason: 'unanswered' });
      toast('No answer', { icon: '📵' });
      dismiss(2500);
    };

    const onUpdated = (data: { call: { id: string; status: string } }) => {
      LOG('call_updated received', JSON.stringify(data));
      const current = useCallsStore.getState().outboundCall;
      LOG('call_updated | current.callId=', current?.callId, '| event call.id=', data.call?.id, '| status=', data.call?.status);
      if (!current || current.callId !== data.call?.id) {
        LOG('call_updated IGNORED — id mismatch or no active call');
        return;
      }

      if (data.call?.status === 'ONGOING' && !current.startedAt) {
        LOG('call_updated ONGOING → setting startedAt + ringing=false (timer start)');
        setOutboundCall({ ...current, startedAt: new Date(), ringing: false });
        return;
      }

      if (!TERMINAL.has(data.call?.status ?? '')) {
        LOG('call_updated status', data.call?.status, '— not terminal, skipping');
        return;
      }

      LOG('call_updated terminal status=', data.call.status, '→ ending call');
      stopAndUpload();
      cleanupSession();
      const reason = data.call.status === 'DECLINED' ? 'declined' :
                     data.call.status === 'UNANSWERED' ? 'unanswered' :
                     data.call.status === 'CANCELED' ? 'canceled' : 'ended';
      setOutboundCall({ ...current, endedReason: reason });
      if (reason === 'ended') toast.success('Call ended');
      dismiss(2000);
    };

    const onEnded = (data: { call: { id: string } }) => {
      LOG('call_ended received', JSON.stringify(data));
      const current = useCallsStore.getState().outboundCall;
      if (!current || current.callId !== data.call?.id) { LOG('call_ended IGNORED'); return; }
      LOG('call_ended → ending call');
      stopAndUpload();
      cleanupSession();
      setOutboundCall({ ...current, endedReason: 'ended' });
      dismiss(2000);
    };

    socket.on('call_ringing', onRinging);
    socket.on('call_accepted', onAccepted);
    socket.on('call_connected', onConnected);
    socket.on('call_declined', onDeclined);
    socket.on('call_unanswered', onUnanswered);
    socket.on('call_updated', onUpdated);
    socket.on('call_ended', onEnded);

    return () => {
      LOG('socket handlers removed');
      socket.off('call_ringing', onRinging);
      socket.off('call_accepted', onAccepted);
      socket.off('call_connected', onConnected);
      socket.off('call_declined', onDeclined);
      socket.off('call_unanswered', onUnanswered);
      socket.off('call_updated', onUpdated);
      socket.off('call_ended', onEnded);
    };
  }, [cleanupSession, dismiss, setOutboundCall, stopAndUpload]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Hang up ────────────────────────────────────────────────────────────────
  const handleHangUp = useCallback(async () => {
    if (!outboundCall) return;
    const duration = outboundCall.startedAt
      ? Math.floor((Date.now() - outboundCall.startedAt.getTime()) / 1000)
      : 0;
    stopAndUpload();
    try { await callsApi.respond(outboundCall.callId, 'terminate'); } catch { /* best-effort */ }
    try {
      await callsApi.update(outboundCall.callId, {
        status: duration > 0 ? 'ENDED' : 'CANCELED',
        duration,
        endedAt: new Date().toISOString(),
      });
    } catch { /* best-effort */ }
    cleanupSession();
    const reason = duration > 0 ? 'ended' : 'canceled';
    setOutboundCall({ ...outboundCall, endedReason: reason });
    if (duration > 0) toast.success(`Call ended — ${formatDuration(duration)}`);
    dismiss(1500);
  }, [outboundCall, cleanupSession, dismiss, setOutboundCall, stopAndUpload]);

  // ── Mute ───────────────────────────────────────────────────────────────────
  const handleMute = useCallback(async () => {
    if (!outboundCall || togglingMute) return;
    const next = !muted;
    setTogglingMute(true);
    setMuted(next);
    const session = useCallsStore.getState().outboundSession;
    if (session?.stream) {
      const track = session.stream.getAudioTracks()[0];
      if (track) track.enabled = !next;
    }
    try { if (outboundCall.callId) await callsApi.mute(outboundCall.callId, next); }
    catch { setMuted(!next); }
    finally { setTogglingMute(false); }
  }, [outboundCall, muted, togglingMute]);

  // ── Hold ───────────────────────────────────────────────────────────────────
  const handleHold = useCallback(async () => {
    if (!outboundCall || togglingHold) return;
    const next = !outboundCall.held;
    setTogglingHold(true);
    try {
      if (outboundCall.callId) await callsApi.hold(outboundCall.callId, next);
      setOutboundCall({ ...outboundCall, held: next });
    } catch { /* ignore */ }
    finally { setTogglingHold(false); }
  }, [outboundCall, togglingHold, setOutboundCall]);

  // ── Drag ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (barRef.current) {
        barRef.current.style.left = `${e.clientX - offset.x}px`;
        barRef.current.style.top  = `${e.clientY - offset.y}px`;
        barRef.current.style.bottom = 'auto';
        barRef.current.style.right  = 'auto';
      }
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging, offset]);

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setDragging(true);
    const rect = barRef.current?.getBoundingClientRect();
    if (rect) setOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  if (!outboundCall) return null;

  // ── Status label / colour ──────────────────────────────────────────────────
  const statusLabel = phase === 'connected' ? formatDuration(elapsed) : PHASE_LABEL[phase];
  const statusColor =
    terminal            ? 'text-red-400 bg-red-500/10 border-red-500/20' :
    phase === 'held'    ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
    phase === 'connected' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
    phase === 'ringing' ? 'text-sky-400 bg-sky-500/10 border-sky-500/20 animate-pulse' :
                          'text-amber-400 bg-amber-500/10 border-amber-500/20 animate-pulse';

  return (
    <div
      ref={barRef}
      onMouseDown={onMouseDown}
      className={cn(
        'fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900 border border-slate-700 rounded-2xl px-5 py-3',
        'flex items-center gap-5 shadow-2xl min-w-80 transition-[opacity,transform] duration-300',
        dismissing ? 'opacity-0 scale-95' : 'opacity-100 scale-100',
        dragging ? 'cursor-grabbing select-none' : 'cursor-grab',
      )}
    >
      {/* Contact info */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <PhoneCall size={18} className={cn(
              terminal ? 'text-red-400' : 'text-emerald-400',
            )} />
          </div>
          {!terminal && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full animate-pulse border-2 border-slate-900" />
          )}
        </div>

        <div className="min-w-0">
          <p className="text-white font-semibold text-sm leading-tight truncate">{outboundCall.contactName}</p>
          <p className="text-slate-400 text-xs truncate">{outboundCall.phone}</p>
        </div>

        {connected && !outboundCall.held && <WaveformBars />}
        {outboundCall.held && <span className="text-amber-400 text-xs font-bold animate-pulse">On Hold</span>}

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className={cn('flex items-center gap-1 font-mono text-sm px-3 py-1 rounded-full border', statusColor)}>
            <Clock size={11} />
            {statusLabel}
          </div>
          {/* Recording indicator */}
          {connected && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/10 border border-red-500/20">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              <span className="text-red-400 text-[10px] font-bold">REC</span>
            </div>
          )}
        </div>
      </div>

      {/* Controls — only visible when not terminal */}
      {!terminal && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => { void handleMute(); }}
            disabled={togglingMute || !connected}
            className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center transition-all',
              muted ? 'bg-red-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600',
              (!connected || togglingMute) && 'opacity-40 cursor-not-allowed',
            )}
          >
            {muted ? <MicOff size={15} /> : <Mic size={15} />}
          </button>

          <button
            onClick={() => { void handleHold(); }}
            disabled={togglingHold || !connected}
            className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center transition-all',
              outboundCall.held ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600',
              (!connected || togglingHold) && 'opacity-40 cursor-not-allowed',
            )}
          >
            <Pause size={15} />
          </button>

          <button
            onClick={() => { void handleHangUp(); }}
            className="h-9 px-5 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center gap-2 text-sm font-bold transition-colors"
          >
            <PhoneOff size={15} />
            {phase === 'ringing' || phase === 'initiating' ? 'Cancel' : 'End'}
          </button>
        </div>
      )}

      {/* Dismiss button when terminal */}
      {terminal && (
        <button
          onClick={() => dismiss(0)}
          className="flex-shrink-0 text-slate-400 hover:text-white text-xs font-medium px-3 py-1 rounded-lg border border-slate-700 hover:border-slate-500 transition-colors"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
