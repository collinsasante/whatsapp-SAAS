import { create } from 'zustand';

export interface IncomingCall {
  callLogId: string;
  whatsappCallId: string;
  from: string;
  contactName: string | null;
  sdpOffer: string | null;
}

export interface OutboundCallSession {
  callLogId: string;
  pc: RTCPeerConnection;
  stream: MediaStream;
  remoteAudio: HTMLAudioElement;
}

export interface OutboundCall {
  callId: string;
  phone: string;
  contactName: string;
  startedAt: Date | null;
  ringing: boolean;
  muted: boolean;
  held: boolean;
  /** Set when the call reaches a terminal state so the bar shows the correct message */
  endedReason?: 'declined' | 'unanswered' | 'canceled' | 'ended' | 'busy' | 'voicemail' | null;
}

export interface ConfirmDial {
  phone: string;
  contactName: string;
  contactId?: string;
}

interface CallsStore {
  incomingCall: IncomingCall | null;
  outboundSession: OutboundCallSession | null;
  outboundCall: OutboundCall | null;
  pendingDial: string | null;
  confirmDial: ConfirmDial | null;

  setIncomingCall: (call: IncomingCall | null) => void;
  clearCallIfMatches: (callLogId: string) => void;
  setOutboundSession: (session: OutboundCallSession | null) => void;
  setOutboundCall: (call: OutboundCall | null) => void;
  setPendingDial: (phone: string | null) => void;
  setConfirmDial: (dial: ConfirmDial | null) => void;
}

export const useCallsStore = create<CallsStore>((set) => ({
  incomingCall: null,
  outboundSession: null,
  outboundCall: null,
  pendingDial: null,
  confirmDial: null,

  setIncomingCall: (call) => set({ incomingCall: call }),
  clearCallIfMatches: (callLogId) =>
    set((state) => ({
      incomingCall: state.incomingCall?.callLogId === callLogId ? null : state.incomingCall,
    })),
  setOutboundSession: (session) => set({ outboundSession: session }),
  setOutboundCall: (call) => set({ outboundCall: call }),
  setPendingDial: (phone) => set({ pendingDial: phone }),
  setConfirmDial: (dial) => set({ confirmDial: dial }),
}));
