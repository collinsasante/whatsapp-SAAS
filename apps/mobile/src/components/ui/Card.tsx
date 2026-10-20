import React from 'react';
import { View, TouchableOpacity, type ViewProps } from 'react-native';

// onBlur/onFocus are typed differently on View and TouchableOpacity, and no Card passes them.
interface CardProps extends Omit<ViewProps, 'onBlur' | 'onFocus'> {
  onPress?: () => void;
  padded?: boolean;
  children: React.ReactNode;
}

/** The bg-surface-card rounded-2xl border card shell repeated across the app. */
export function Card({ onPress, padded = true, className, children, ...rest }: CardProps) {
  const base = `bg-light-card dark:bg-surface-card rounded-2xl border border-light-border dark:border-white/5 overflow-hidden ${padded ? 'p-4' : ''} ${className ?? ''}`;

  if (onPress) {
    return (
      <TouchableOpacity className={base} onPress={onPress} activeOpacity={0.8} {...rest}>
        {children}
      </TouchableOpacity>
    );
  }

  return (
    <View className={base} {...rest}>
      {children}
    </View>
  );
}
