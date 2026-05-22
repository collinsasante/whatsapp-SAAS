'use client';
import { useEffect, useRef, useState } from 'react';
import { Phone, X, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { callsApi } from '@/lib/api';
import { useCallsStore } from '@/store/calls.store';
import { getSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';

function detectRemoteAudioActivity(stream: MediaStream, onDetected: () => void) {
  try {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let consecutive = 0;
    const id = setInterval(() => {
      analyser.getByteFrequencyData(data);
      if (data.some(v => v > 12)) {
        if (++consecutive >= 3) {
          clearInterval(id);
          source.disconnect();
          void ctx.close();
          onDetected();
        }
      } else {
        consecutive = 0;
      }
    }, 200);
    setTimeout(() => clearInterval(id), 90_000);
  } catch { /* AudioContext unavailable */ }
}

// Meta Cloud API returns: granted | pending | denied | expired
// no_permission = no record exists at all; requesting = request in-flight
type PermissionStatus = 'unknown' | 'checking' | 'no_permission' | 'granted' | 'pending' | 'denied' | 'expired' | 'requesting';

export function OutboundDialModal() {
  const { pendingDial, setPendingDial, setOutboundSession, setOutboundCall } = useCallsStore();
  const [number, setNumber] = useState('');
  const [calling, setCalling] = useState(false);
  const [permission, setPermission] = useState<PermissionStatus>('unknown');
  const permCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const numberRef = useRef(number);
  numberRef.current = number;

  useEffect(() => {
    if (pendingDial !== null) setNumber(pendingDial);
  }, [pendingDial]);

  useEffect(() => {
    const phone = number.trim();
    if (!phone || phone.length < 7) { setPermission('unknown'); return; }
    if (permCheckRef.current) clearTimeout(permCheckRef.current);
    permCheckRef.current = setTimeout(async () => {
      setPermission('checking');
      try {
        const res = await callsApi.getPermission(phone);
        const d = res.data as { status: string; canCall: boolean };
        setPermission(d.status as PermissionStatus);
      } catch { setPermission('unknown'); }
    }, 600);
    return () => { if (permCheckRef.current) clearTimeout(permCheckRef.current); };
  }, [number]);

  // Real-time: when the contact accepts/rejects on their phone, update the badge instantly
  useEffect(() => {
    const socket = getSocket();
    const handler = (data: { call: { phone: string; granted: boolean; response: string } }) => {
      const dialPhone = numberRef.current.trim().replace(/^\+/, '');
      const eventPhone = (data?.call?.phone ?? '').replace(/^\+/, '');
      if (eventPhone && dialPhone && eventPhone.endsWith(dialPhone.slice(-9))) {
        setPermission(data.call.granted ? 'granted' : 'denied');
        toast.success(data.call.granted ? 'Call permission granted!' : 'Call permission denied');
      }
    };
    socket.on('call_permission_updated', handler);
    return () => { socket.off('call_permission_updated', handler); };
  }, []);

  const handleClose = () => { setPendingDial(null); setNumber(''); setPermission('unknown'); };

  const handleRequestPermission = async () => {
    const phone = number.trim();
    if (!phone) return;
    setPermission('requesting');
    try {
      await callsApi.requestPermission(phone);
      toast.success('Call permission request sent via WhatsApp');
      setPermission('no_permission');
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '';
      toast.error(raw || 'Failed to send permission request');
      setPermission('no_permission');
    }
  };

  const handleCall = async () => {
    const phone = number.trim();
    if (!phone) return;
    setCalling(true);
    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (pc.iceGatheringState !== 'complete') {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 4000);
          pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
          });
        });
      }
      const sdpOffer = pc.localDescription!.sdp;

      const remoteAudio = document.createElement('audio');
      remoteAudio.autoplay = true;
      remoteAudio.setAttribute('playsinline', '');
      document.body.appendChild(remoteAudio);

      let callIdLocal = '';

      pc.ontrack = (ev) => {
        const remoteStream = ev.streams[0] ?? new MediaStream([ev.track]);
        remoteAudio.srcObject = remoteStream;
        void remoteAudio.play().catch(() => {
          const retry = () => { void remoteAudio.play().catch(() => {}); document.removeEventListener('click', retry); };
          document.addEventListener('click', retry, { once: true });
        });

        if (ev.track.kind === 'audio') {
          detectRemoteAudioActivity(remoteStream, () => {
            const currentCall = useCallsStore.getState().outboundCall;
            if (callIdLocal && currentCall?.callId === callIdLocal && !currentCall.endedReason) {
              void callsApi.respond(callIdLocal, 'accept');
            }
          });
        }
      };

      const res = await callsApi.initiate({ phone, type: 'audio', sdpOffer });
      const data = res.data as { id: string };
      callIdLocal = data.id;
      setOutboundSession({ callLogId: data.id, pc, stream, remoteAudio });
      setOutboundCall({ callId: data.id, phone, contactName: phone, startedAt: null, ringing: false, muted: false, held: false });
      handleClose();
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '';
      const msg = raw.includes('call permission') || raw.includes('approved call') || raw.includes('138006')
        ? 'This number has not granted call permission. Request permission first.'
        : raw || 'Failed to initiate call';
      toast.error(msg);
    } finally { setCalling(false); }
  };

  const permBadge = () => {
    if (permission === 'checking') return <span className="text-[10px] text-gray-400 flex items-center gap-1"><span className="w-2 h-2 border border-gray-300 border-t-gray-500 rounded-full animate-spin inline-block" />Checking…</span>;
    if (permission === 'granted')  return <span className="text-[10px] text-emerald-600 font-bold">✓ Call permission granted</span>;
    if (permission === 'pending')  return <span className="text-[10px] text-blue-600 font-bold">⏳ Permission request pending</span>;
    if (permission === 'denied')   return <span className="text-[10px] text-red-600 font-bold">✗ Permission denied</span>;
    if (permission === 'expired')  return <span className="text-[10px] text-amber-600 font-bold">⚠ Permission expired — request again</span>;
    if (permission === 'no_permission') return <span className="text-[10px] text-amber-600 font-bold">⚠ No call permission</span>;
    if (permission === 'requesting') return <span className="text-[10px] text-gray-500 flex items-center gap-1"><span className="w-2 h-2 border border-gray-300 border-t-teal-500 rounded-full animate-spin inline-block" />Sending request…</span>;
    return null;
  };

  if (pendingDial === null) return null;

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '⌫'];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={handleClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 text-base">New call</h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg transition-colors"><X size={16} /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
              <Phone size={14} className="text-gray-400 flex-shrink-0" />
              <input value={number} onChange={e => setNumber(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleCall(); }}
                placeholder="+1 (555) 000-0000" autoFocus
                className="flex-1 bg-transparent text-lg font-mono text-gray-900 outline-none placeholder-gray-300 tracking-wider" />
              {number && <button onClick={() => setNumber(p => p.slice(0, -1))} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>}
            </div>
            {number.trim().length >= 7 && (
              <div className="mt-1.5 px-1 flex items-center justify-between">
                {permBadge()}
                {(['no_permission', 'denied', 'expired'] as PermissionStatus[]).includes(permission) && (
                  <button onClick={() => { void handleRequestPermission(); }}
                    className="text-[10px] font-bold text-teal-600 hover:text-teal-800 underline">
                    Send permission request
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {digits.map(d => (
              <button key={d} onClick={() => d === '⌫' ? setNumber(p => p.slice(0, -1)) : setNumber(p => p + d)}
                className="h-12 rounded-xl bg-gray-50 hover:bg-gray-100 text-gray-900 font-semibold text-lg transition-colors border border-gray-100 active:scale-95">{d}</button>
            ))}
          </div>
          {(['no_permission', 'denied', 'expired'] as PermissionStatus[]).includes(permission) && (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-2.5 rounded-xl border border-amber-200">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              <span>
                {permission === 'denied'
                  ? "This number denied the call permission request."
                  : permission === 'expired'
                  ? "This number's call permission has expired."
                  : "This number hasn't granted call permission."}
                {' '}Send a permission request via WhatsApp first.
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={handleClose} className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={() => { void handleCall(); }} disabled={calling || !number.trim()}
              className={cn('flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2 transition-colors')}>
              {calling ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Connecting…</> : <><Phone size={15} />Call</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
