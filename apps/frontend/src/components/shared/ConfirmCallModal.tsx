'use client';
import { useState } from 'react';
import { Phone, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { callsApi } from '@/lib/api';
import { useCallsStore } from '@/store/calls.store';

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

export function ConfirmCallModal() {
  const { confirmDial, setConfirmDial, setOutboundSession, setOutboundCall } = useCallsStore();
  const [calling, setCalling] = useState(false);

  if (!confirmDial) return null;

  const { phone, contactName } = confirmDial;

  const handleCall = async () => {
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

      // callId is populated after initiate() resolves; ontrack/onunmute fire later
      let callIdLocal = '';

      pc.ontrack = (ev) => {
        const remoteStream = ev.streams[0] ?? new MediaStream([ev.track]);
        remoteAudio.srcObject = remoteStream;
        void remoteAudio.play().catch(() => {
          const retry = () => { void remoteAudio.play().catch(() => {}); document.removeEventListener('click', retry); };
          document.addEventListener('click', retry, { once: true });
        });

        // Detect when remote audio energy starts flowing — that's the moment the callee answered.
        // Meta's gateway routes audio only after pick-up, so this is a reliable real-time signal.
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
      setOutboundCall({ callId: data.id, phone, contactName: contactName || phone, startedAt: null, ringing: false, muted: false, held: false });
      setConfirmDial(null);
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '';
      const msg = raw.includes('call permission') || raw.includes('approved call') || raw.includes('138006')
        ? 'This number has not granted call permission. Request permission first.'
        : raw || 'Failed to initiate call';
      toast.error(msg);
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setConfirmDial(null)}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-gray-900 text-base">Call contact</h3>
          <button onClick={() => setConfirmDial(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex items-center gap-3 mb-6 p-4 bg-gray-50 rounded-xl border border-gray-100">
          <div className="w-11 h-11 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
            <Phone size={17} className="text-teal-600" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate">{contactName || phone}</p>
            {contactName && contactName !== phone && (
              <p className="text-sm text-gray-500 truncate">{phone}</p>
            )}
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setConfirmDial(null)}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { void handleCall(); }}
            disabled={calling}
            className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2 transition-colors"
          >
            {calling
              ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Calling…</>
              : <><Phone size={15} />Call</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
