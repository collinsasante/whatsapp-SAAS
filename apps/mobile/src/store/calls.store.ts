import { create } from 'zustand';
import type { MediaStream, RTCPeerConnection } from 'react-native-webrtc';

// Mirrors apps/frontend/src/store/calls.store.ts exactly -- same shape, same
// state machine, only the WebRTC types differ (react-native-webrtc instead
// of DOM globals). Keep these two stores in sync if the web call logic changes.

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
}

export interface OutboundCall {
  callId: string;
  phone: string;
  contactName: string;
  startedAt: Date | null;
  ringing: boolean;
  muted: boolean;
  held: boolean;
  endedReason?: 'declined' | 'unanswered' | 'canceled' | 'ended' | 'busy' | 'voicemail' | null;
}

export interface ConfirmDial {
  phone: string;
  contactName: string;
  contactId?: string;
}

interface CallsState {
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

export const useCallsStore = create<CallsState>((set) => ({
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
