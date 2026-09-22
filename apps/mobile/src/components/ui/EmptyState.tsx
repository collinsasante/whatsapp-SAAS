import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/useAppTheme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface EmptyStateProps {
  icon: IoniconName;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  const { colors } = useAppTheme();
  return (
    <View className="items-center justify-center px-8 py-16">
      <View className="w-16 h-16 rounded-full bg-light-elevated dark:bg-white/5 items-center justify-center mb-4">
        <Ionicons name={icon} size={28} color={colors.textMuted} />
      </View>
      <Text className="text-light-text-secondary dark:text-white/70 text-base font-semibold text-center">{title}</Text>
      {description && (
        <Text className="text-light-text-muted dark:text-white/35 text-sm text-center mt-1.5 leading-5">{description}</Text>
      )}
      {actionLabel && onAction && (
        <TouchableOpacity
          className="bg-green/15 rounded-xl px-5 py-2.5 mt-5"
          onPress={onAction}
          activeOpacity={0.8}
        >
          <Text className="text-green font-semibold text-sm">{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message = 'Something went wrong', onRetry }: ErrorStateProps) {
  const { colors } = useAppTheme();
  return (
    <View className="items-center justify-center px-8 py-16">
      <View className="w-16 h-16 rounded-full bg-red/15 items-center justify-center mb-4">
        <Ionicons name="alert-circle-outline" size={28} color="#ef4444" />
      </View>
      <Text className="text-light-text-secondary dark:text-white/70 text-base font-semibold text-center">{message}</Text>
      <Text className="text-light-text-muted dark:text-white/35 text-sm text-center mt-1.5">Please try again.</Text>
      {onRetry && (
        <TouchableOpacity
          className="border border-light-border dark:border-white/15 rounded-xl px-5 py-2.5 mt-5 flex-row items-center gap-2"
          onPress={onRetry}
          activeOpacity={0.8}
        >
          <Ionicons name="refresh" size={16} color={colors.textPrimary} />
          <Text className="text-light-text-primary dark:text-white font-semibold text-sm">Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
