import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RTCPeerConnection, mediaDevices, type MediaStream } from 'react-native-webrtc';
import { apiClient } from '../../lib/api';
import { useCallsStore } from '../../store/calls.store';
import { socketClient } from '../../lib/socket';
import { BottomSheet } from '../ui';
import { tapLight } from '../../lib/haptics';
import { useAppTheme } from '../../theme/useAppTheme';

// Mirrors apps/frontend/src/components/shared/OutboundDialModal.tsx's dial
// flow exactly (permission check, offer creation, ICE gathering, POST
// /calls/initiate) -- minus the browser-only ring-tone/audio-activity
// detection, which has no React Native equivalent and isn't part of the
// actual call *logic*.

// Meta Cloud API returns: granted | pending | denied | expired
type PermissionStatus = 'unknown' | 'checking' | 'no_permission' | 'granted' | 'pending' | 'denied' | 'expired' | 'requesting';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export function DialPad() {
  const { colors } = useAppTheme();
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
        const res = await apiClient.calls.getPermission(phone);
        const d = res.data as { status: string; canCall: boolean };
        setPermission(d.status as PermissionStatus);
      } catch { setPermission('unknown'); }
    }, 600);
    return () => { if (permCheckRef.current) clearTimeout(permCheckRef.current); };
  }, [number]);

  // Real-time: contact accepts/rejects the permission request on their phone
  useEffect(() => {
    const handler = (data: { call: { phone: string; granted: boolean; response: string } }) => {
      const dialPhone = numberRef.current.trim().replace(/^\+/, '');
      const eventPhone = (data?.call?.phone ?? '').replace(/^\+/, '');
      if (eventPhone && dialPhone && eventPhone.endsWith(dialPhone.slice(-9))) {
        setPermission(data.call.granted ? 'granted' : 'denied');
      }
    };
    socketClient.on('call_permission_updated', handler);
    return () => socketClient.off('call_permission_updated', handler);
  }, []);

  const handleClose = () => { setPendingDial(null); setNumber(''); setPermission('unknown'); };

  const handleRequestPermission = async () => {
    const phone = number.trim();
    if (!phone) return;
    setPermission('requesting');
    try {
      await apiClient.calls.requestPermission(phone);
      Alert.alert('Sent', 'Call permission request sent via WhatsApp');
      setPermission('no_permission');
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '';
      Alert.alert('Error', raw || 'Failed to send permission request');
      setPermission('no_permission');
    }
  };

  const handleCall = async () => {
    const phone = number.trim();
    if (!phone) return;
    setCalling(true);
    try {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const stream = (await mediaDevices.getUserMedia({ audio: true, video: false })) as MediaStream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer({});
      await pc.setLocalDescription(offer);
      if (pc.iceGatheringState !== 'complete') {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 4000);
          // @ts-expect-error react-native-webrtc supports this event, types lag slightly behind the DOM lib
          pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
          });
        });
      }
      const sdpOffer = pc.localDescription!.sdp;

      const res = await apiClient.calls.initiate({ phone, type: 'audio', sdpOffer });
      const data = res.data as { id: string };
      setOutboundSession({ callLogId: data.id, pc, stream });
      setOutboundCall({ callId: data.id, phone, contactName: phone, startedAt: null, ringing: false, muted: false, held: false });
      handleClose();
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '';
      const msg = raw.includes('call permission') || raw.includes('approved call') || raw.includes('138006')
        ? 'This number has not granted call permission. Request permission first.'
        : raw || 'Failed to initiate call';
      Alert.alert('Call failed', msg);
    } finally {
      setCalling(false);
    }
  };

  const permLabel = (): { text: string; color: string } | null => {
    if (permission === 'checking') return { text: 'Checking…', color: colors.textMuted };
    if (permission === 'granted') return { text: '✓ Call permission granted', color: '#25D366' };
    if (permission === 'pending') return { text: '⏳ Permission request pending', color: '#3b82f6' };
    if (permission === 'denied') return { text: '✗ Permission denied', color: '#ef4444' };
    if (permission === 'expired') return { text: '⚠ Permission expired — request again', color: '#eab308' };
    if (permission === 'no_permission') return { text: '⚠ No call permission', color: '#eab308' };
    if (permission === 'requesting') return { text: 'Sending request…', color: colors.textMuted };
    return null;
  };

  if (pendingDial === null) return null;

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '⌫'];
  const label = permLabel();
  const needsPermission = (['no_permission', 'denied', 'expired'] as PermissionStatus[]).includes(permission);

  return (
    <BottomSheet visible={pendingDial !== null} onClose={handleClose} title="New Call">
      <View className="px-5 py-4" style={{ gap: 14 }}>
        <View>
          <View className="flex-row items-center gap-2 bg-light-card dark:bg-surface-card border border-light-border dark:border-white/10 rounded-xl px-4 py-3.5">
            <Ionicons name="call-outline" size={16} color={colors.textMuted} />
            <TextInput
              value={number}
              onChangeText={setNumber}
              placeholder="+1 (555) 000-0000"
              placeholderTextColor={colors.textDisabled}
              autoFocus
              keyboardType="phone-pad"
              className="flex-1 text-light-text-primary dark:text-white text-lg"
              onSubmitEditing={() => void handleCall()}
            />
            {number !== '' && (
              <TouchableOpacity onPress={() => setNumber((p) => p.slice(0, -1))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          {number.trim().length >= 7 && label && (
            <View className="flex-row items-center justify-between mt-1.5 px-1">
              <Text className="text-xs font-semibold" style={{ color: label.color }}>{label.text}</Text>
              {needsPermission && (
                <TouchableOpacity onPress={() => void handleRequestPermission()}>
                  <Text className="text-green text-xs font-bold underline">Send permission request</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {digits.map((d) => (
            <TouchableOpacity
              key={d}
              onPress={() => { tapLight(); d === '⌫' ? setNumber((p) => p.slice(0, -1)) : setNumber((p) => p + d); }}
              className="bg-light-card dark:bg-surface-card border border-light-border dark:border-white/10 rounded-xl items-center justify-center"
              style={{ width: '31%', height: 48 }}
              activeOpacity={0.7}
            >
              <Text className="text-light-text-primary dark:text-white text-lg font-semibold">{d}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {needsPermission && (
          <View className="flex-row items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3.5 py-3">
            <Ionicons name="alert-circle-outline" size={15} color="#eab308" style={{ marginTop: 1 }} />
            <Text className="flex-1 text-amber-300 text-xs leading-4">
              {permission === 'denied'
                ? 'This number denied the call permission request.'
                : permission === 'expired'
                ? "This number's call permission has expired."
                : "This number hasn't granted call permission."}{' '}
              Send a permission request via WhatsApp first.
            </Text>
          </View>
        )}

        <View className="flex-row gap-2">
          <TouchableOpacity onPress={handleClose} className="flex-1 border border-light-border dark:border-white/10 rounded-xl py-3.5 items-center">
            <Text className="text-light-text-secondary dark:text-white/60 font-medium">Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void handleCall()}
            disabled={calling || !number.trim()}
            className="flex-1 bg-green rounded-xl py-3.5 items-center flex-row justify-center gap-2"
            style={{ opacity: calling || !number.trim() ? 0.5 : 1 }}
          >
            {calling ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="call" size={15} color="#fff" />}
            <Text className="text-white font-bold">{calling ? 'Connecting…' : 'Call'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}
