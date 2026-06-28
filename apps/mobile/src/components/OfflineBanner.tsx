import React, { useEffect, useRef } from 'react';
import { View, Text, Animated } from 'react-native';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export function OfflineBanner() {
  const isOnline = useNetworkStatus();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: isOnline ? 0 : 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isOnline, opacity]);

  if (isOnline) return null;

  return (
    <Animated.View style={{ opacity }}>
      <View className="bg-red-600 px-4 py-2 items-center flex-row justify-center gap-2">
        <View className="w-2 h-2 rounded-full bg-white/70" />
        <Text className="text-white text-xs font-semibold tracking-wide">
          No internet connection
        </Text>
      </View>
    </Animated.View>
  );
}
