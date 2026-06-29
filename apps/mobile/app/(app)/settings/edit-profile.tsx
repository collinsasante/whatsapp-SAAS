import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiClient } from '../../../src/lib/api';
import { useAuthStore } from '../../../src/store/auth.store';

export default function EditProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);

  const [name, setName] = useState(user?.name ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Validation', 'Name cannot be empty.');
      return;
    }
    setIsSaving(true);
    try {
      await apiClient.auth.updateMe({ name: name.trim() });
      updateUser({ name: name.trim() });
      Alert.alert('Saved', 'Your profile has been updated.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert('Error', 'Could not save profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-4 py-3 border-b border-white/5">
        <TouchableOpacity onPress={() => router.back()} className="mr-3 p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text className="text-green text-base">←</Text>
        </TouchableOpacity>
        <Text className="text-white font-semibold text-base flex-1">Edit Profile</Text>
        <TouchableOpacity onPress={handleSave} disabled={isSaving}>
          {isSaving ? (
            <ActivityIndicator color="#25D366" size="small" />
          ) : (
            <Text className="text-green font-semibold text-sm">Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
          {/* Avatar placeholder */}
          <View className="items-center mb-8">
            <View className="w-24 h-24 rounded-full bg-green/20 items-center justify-center border-2 border-green/30 mb-2">
              <Text className="text-green font-extrabold text-4xl">
                {(name || user?.name || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text className="text-white/30 text-xs">Photo upload available in a future update</Text>
          </View>

          <View className="gap-4">
            <View>
              <Text className="text-white/70 text-sm font-medium mb-2">Full Name</Text>
              <TextInput
                className="bg-surface-card border border-white/10 rounded-xl px-4 py-3.5 text-white text-base"
                placeholder="Your name"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSave}
              />
            </View>

            <View>
              <Text className="text-white/70 text-sm font-medium mb-2">Email</Text>
              <View className="bg-surface-card/50 border border-white/5 rounded-xl px-4 py-3.5">
                <Text className="text-white/40 text-base">{user?.email}</Text>
              </View>
              <Text className="text-white/30 text-xs mt-1.5">Email cannot be changed here</Text>
            </View>

            <View>
              <Text className="text-white/70 text-sm font-medium mb-2">Role</Text>
              <View className="bg-surface-card/50 border border-white/5 rounded-xl px-4 py-3.5">
                <Text className="text-white/40 text-base capitalize">
                  {user?.role?.toLowerCase().replace(/_/g, ' ') ?? '—'}
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
