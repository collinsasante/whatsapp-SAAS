import React from 'react';
import { View, Text } from 'react-native';
import { Link, Stack } from 'expo-router';

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not Found' }} />
      <View className="flex-1 items-center justify-center bg-surface">
        <Text className="text-white text-xl font-bold mb-4">Page not found</Text>
        <Link href="/" className="text-green">
          <Text className="text-green text-base">Go home</Text>
        </Link>
      </View>
    </>
  );
}
