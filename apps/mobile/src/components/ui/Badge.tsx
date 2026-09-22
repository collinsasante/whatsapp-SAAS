import React from 'react';
import { View, Text } from 'react-native';
import { useAppTheme } from '../../theme/useAppTheme';

export type BadgeTone = 'green' | 'blue' | 'purple' | 'orange' | 'red' | 'yellow' | 'pink' | 'teal' | 'neutral';

const TONE_COLOR: Record<Exclude<BadgeTone, 'neutral'>, string> = {
  green: '#25D366',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  orange: '#f97316',
  red: '#ef4444',
  yellow: '#eab308',
  pink: '#ec4899',
  teal: '#14b8a6',
};

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  /** Solid dot instead of a soft pill background -- for compact status rows. */
  dot?: boolean;
}

export function Badge({ label, tone = 'neutral', dot }: BadgeProps) {
  const { colors } = useAppTheme();
  const color = tone === 'neutral' ? colors.textSecondary : TONE_COLOR[tone];

  if (dot) {
    return (
      <View className="flex-row items-center gap-1.5">
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
        <Text className="text-xs" style={{ color }}>{label}</Text>
      </View>
    );
  }

  return (
    <View className="px-2 py-0.5 rounded-full self-start" style={{ backgroundColor: color + '26' }}>
      <Text className="text-xs font-semibold" style={{ color }}>{label}</Text>
    </View>
  );
}
