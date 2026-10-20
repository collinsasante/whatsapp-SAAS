import React from 'react';
import { Stack } from 'expo-router';
import { useAppTheme } from '../../../src/theme/useAppTheme';

export default function InboxLayout() {
  const { colors } = useAppTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    />
  );
}
