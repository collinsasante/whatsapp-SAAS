import React, { useEffect } from 'react';
import { View, type DimensionValue } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useAppTheme } from '../../theme/useAppTheme';

interface SkeletonBlockProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: object;
}

export function SkeletonBlock({ width = '100%', height = 14, radius = 6, style }: SkeletonBlockProps) {
  const { isDark } = useAppTheme();
  const opacity = useSharedValue(0.35);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.75, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)' },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** Skeleton for a typical avatar + two-line row (inbox, contacts, team lists). */
export function SkeletonListItem() {
  return (
    <View className="flex-row items-center gap-3 px-4 py-3.5">
      <SkeletonBlock width={44} height={44} radius={22} />
      <View className="flex-1" style={{ gap: 8 }}>
        <SkeletonBlock width="55%" height={13} />
        <SkeletonBlock width="80%" height={11} />
      </View>
    </View>
  );
}

export function SkeletonList({ count = 6 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonListItem key={i} />
      ))}
    </View>
  );
}

/** Skeleton for a stat/KPI card grid (dashboard, analytics). */
export function SkeletonCard({ height = 80 }: { height?: number }) {
  return (
    <View className="bg-light-card dark:bg-surface-card rounded-2xl border border-light-border dark:border-white/5 p-4 flex-1">
      <SkeletonBlock width="50%" height={11} style={{ marginBottom: 10 }} />
      <SkeletonBlock width="70%" height={height > 60 ? 22 : 16} />
    </View>
  );
}
