import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Plays back CallLog.recordingUrl -- mirrors web's <audio controls src={call.recordingUrl} /> */
export function RecordingPlayer({ url }: { url: string }) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);

  const toggle = () => {
    if (status.playing) player.pause();
    else player.play();
  };

  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;

  return (
    <View className="bg-light-card dark:bg-surface-card rounded-2xl p-4 mb-4">
      <Text className="text-light-text-muted dark:text-white/40 text-sm mb-3">Call Recording</Text>
      <View className="flex-row items-center gap-3">
        <TouchableOpacity
          onPress={toggle}
          className="w-11 h-11 rounded-full bg-green items-center justify-center"
          activeOpacity={0.8}
        >
          <Ionicons name={status.playing ? 'pause' : 'play'} size={18} color="#fff" style={{ marginLeft: status.playing ? 0 : 2 }} />
        </TouchableOpacity>
        <View className="flex-1">
          <View className="h-1.5 bg-light-border dark:bg-white/10 rounded-full overflow-hidden">
            <View className="h-full bg-green rounded-full" style={{ width: `${Math.min(progress * 100, 100)}%` }} />
          </View>
          <View className="flex-row justify-between mt-1.5">
            <Text className="text-light-text-muted dark:text-white/40 text-xs">{formatTime(status.currentTime)}</Text>
            <Text className="text-light-text-muted dark:text-white/40 text-xs">{formatTime(status.duration)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
