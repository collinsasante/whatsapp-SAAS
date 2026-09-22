import React from 'react';
import { TouchableOpacity, Text, View } from 'react-native';
import { useAppTheme } from '../../theme/useAppTheme';

export interface FilterChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  count?: number;
  urgent?: boolean;
}

/** Horizontal pill filter used for status tabs (inbox, campaigns, commerce, etc). */
export function FilterChip({ label, active, onPress, count, urgent }: FilterChipProps) {
  const { colors, isDark } = useAppTheme();
  const badgeBg = active ? 'rgba(255,255,255,0.25)' : urgent ? '#f97316' : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(15,23,42,0.1)');
  const badgeText = active || urgent || isDark ? '#fff' : colors.textPrimary;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      className={`flex-row items-center gap-1.5 px-4 py-2 rounded-full ${
        active ? 'bg-green' : 'bg-light-card dark:bg-surface-card border border-light-border dark:border-white/10'
      }`}
    >
      <Text className={`text-sm font-medium ${active ? 'text-white' : 'text-light-text-secondary dark:text-white/50'}`}>{label}</Text>
      {count != null && count > 0 && (
        <View
          className="rounded-full min-w-[18px] h-[18px] items-center justify-center px-1"
          style={{ backgroundColor: badgeBg }}
        >
          <Text className="text-[10px] font-bold" style={{ color: badgeText }}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}
