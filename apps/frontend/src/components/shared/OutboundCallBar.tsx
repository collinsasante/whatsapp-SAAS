'use client';
import { useEffect, useRef, useState } from 'react';
import { PhoneCall, PhoneOff, Mic, MicOff, Pause, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { callsApi } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useCallsStore } from '@/store/calls.store';
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
  if (seconds < 60) return `0:${String(seconds).padStart(2, '0')}`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}:${String(s).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function OutboundCallBar() {
  const { outboundCall, setOutboundCall, outboundSession, setOutboundSession } = useCallsStore();
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const connected = outboundCall?.startedAt !== null && outboundCall?.startedAt !== undefined;
  const ringing = !connected && (outboundCall?.ringing ?? false);

  // Timer — only counts once user has answered (connected)
  useEffect(() => {
    if (!connected) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [connected]);

  // Reset elapsed when a new call starts
  useEffect(() => {
    if (outboundCall) setElapsed(0);
  }, [outboundCall?.callId]); // eslint-disable-line react-hooks/exhaustive-deps

  // WebRTC connection state → start timer when audio is actually flowing (user answered)
  useEffect(() => {
    const session = outboundSession;
    if (!session?.pc) return;
    const handleStateChange = () => {
      if (session.pc.connectionState === 'connected') {
        const current = useCallsStore.getState().outboundCall;
        if (current && !current.startedAt) {
          setOutboundCall({ ...current, startedAt: new Date() });
        }
      }
    };
    session.pc.addEventListener('connectionstatechange', handleStateChange);
    return () => session.pc.removeEventListener('connectionstatechange', handleStateChange);
  }, [outboundSession, setOutboundCall]);

  // Socket: call_connected fires when user picks up (accept event from Meta)
  // call_updated fires when remote hangs up
  useEffect(() => {
    const socket = getSocket();

    socket.on('call_connected', (data: { call: { callLogId: string } }) => {
      const current = useCallsStore.getState().outboundCall;
      if (!current || current.callId !== data.call?.callLogId) return;
      if (!current.startedAt) setOutboundCall({ ...current, startedAt: new Date() });
    });

    socket.on('call_updated', (data: { call: { id: string; status: string } }) => {
      const ended = ['COMPLETED', 'MISSED', 'FAILED', 'CANCELLED'].includes(data.call?.status ?? '');
      if (!ended) return;
      const current = useCallsStore.getState().outboundCall;
      if (!current || current.callId !== data.call?.id) return;
      cleanupSession();
      setOutboundCall(null);
      toast.success('Call ended');
    });

    return () => {
      socket.off('call_connected');
      socket.off('call_updated');
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cleanupSession = () => {
    const session = useCallsStore.getState().outboundSession;
    if (!session) return;
    try { session.pc.close(); } catch { /* ignore */ }
    session.stream.getTracks().forEach(t => t.stop());
    try { session.remoteAudio.srcObject = null; session.remoteAudio.remove(); } catch { /* ignore */ }
    setOutboundSession(null);
  };

  const handleHangUp = async () => {
    if (!outboundCall) return;
    try { await callsApi.respond(outboundCall.callId, 'terminate'); } catch { /* best-effort */ }
    const duration = outboundCall.startedAt ? Math.floor((Date.now() - outboundCall.startedAt.getTime()) / 1000) : 0;
    try { await callsApi.update(outboundCall.callId, { status: 'COMPLETED', duration, endedAt: new Date().toISOString() }); } catch { /* best-effort */ }
    cleanupSession();
    setOutboundCall(null);
    toast.success(`Call ended${duration > 0 ? ` — ${formatDuration(duration)}` : ''}`);
  };

  const handleMute = async () => {
    if (!outboundCall) return;
    const next = !muted;
    setMuted(next);
    const session = useCallsStore.getState().outboundSession;
    if (session?.stream) {
      const track = session.stream.getAudioTracks()[0];
      if (track) track.enabled = !next;
    }
    try { if (outboundCall.callId) await callsApi.mute(outboundCall.callId, next); } catch { setMuted(!next); }
  };

  const handleHold = async () => {
    if (!outboundCall) return;
    const next = !held;
    setHeld(next);
    try { if (outboundCall.callId) await callsApi.hold(outboundCall.callId, next); } catch { setHeld(!next); }
  };

  // Drag
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (barRef.current) {
        barRef.current.style.left = `${e.clientX - offset.x}px`;
        barRef.current.style.top = `${e.clientY - offset.y}px`;
        barRef.current.style.bottom = 'auto';
        barRef.current.style.right = 'auto';
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

  const statusLabel = connected ? formatDuration(elapsed) : ringing ? 'Ringing…' : 'Calling…';
  const statusColor = connected
    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    : ringing
      ? 'text-sky-400 bg-sky-500/10 border-sky-500/20 animate-pulse'
      : 'text-amber-400 bg-amber-500/10 border-amber-500/20 animate-pulse';

  return (
    <div ref={barRef} onMouseDown={onMouseDown}
      className={cn(
        'fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900 border border-slate-700 rounded-2xl px-5 py-3 flex items-center gap-5 shadow-2xl min-w-80',
        dragging ? 'cursor-grabbing select-none' : 'cursor-grab',
      )}>
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <PhoneCall size={18} className="text-emerald-400" />
          </div>
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full animate-pulse border-2 border-slate-900" />
        </div>
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm leading-tight truncate">{outboundCall.contactName}</p>
          <p className="text-slate-400 text-xs truncate">{outboundCall.phone}</p>
        </div>
        {connected && !held && <WaveformBars />}
        {held && <span className="text-amber-400 text-xs font-bold animate-pulse">On Hold</span>}
        <div className={cn('flex items-center gap-1 font-mono text-sm px-3 py-1 rounded-full border flex-shrink-0', statusColor)}>
          <Clock size={11} />
          {statusLabel}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button onClick={() => { void handleMute(); }}
          className={cn('w-9 h-9 rounded-full flex items-center justify-center transition-all', muted ? 'bg-red-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600')}>
          {muted ? <MicOff size={15} /> : <Mic size={15} />}
        </button>
        <button onClick={() => { void handleHold(); }}
          className={cn('w-9 h-9 rounded-full flex items-center justify-center transition-all', held ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600')}>
          <Pause size={15} />
        </button>
        <button onClick={() => { void handleHangUp(); }}
          className="w-9 h-9 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white transition-all">
          <PhoneOff size={15} />
        </button>
      </div>
    </div>
  );
}
