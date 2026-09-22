import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface StatCardProps {
  label: string;
  value: string | number;
  icon?: IoniconName;
  color?: string;
  urgent?: boolean;
  onPress?: () => void;
}

export function StatCard({ label, value, icon, color = '#25D366', urgent, onPress }: StatCardProps) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      className={`bg-light-card dark:bg-surface-card rounded-2xl border p-4 flex-1 ${urgent ? 'border-orange-500/30' : 'border-light-border dark:border-white/5'}`}
      onPress={onPress}
      {...(onPress ? { activeOpacity: 0.8 } : {})}
    >
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-light-text-muted dark:text-white/40 text-xs font-medium" numberOfLines={1}>{label}</Text>
        {icon && (
          <View className="w-6 h-6 rounded-lg items-center justify-center" style={{ backgroundColor: color + '20' }}>
            <Ionicons name={icon} size={13} color={color} />
          </View>
        )}
      </View>
      <Text className="text-light-text-primary dark:text-white font-bold text-2xl">{value}</Text>
    </Wrapper>
  );
}
