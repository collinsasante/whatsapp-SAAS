import React from 'react';
import { Stack } from 'expo-router';

export default function InboxLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0d1117' },
        animation: 'slide_from_right',
      }}
    />
  );
}
