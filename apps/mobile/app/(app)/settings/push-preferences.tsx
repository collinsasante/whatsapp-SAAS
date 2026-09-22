import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, Switch, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import * as Notifications from 'expo-notifications';
import {
  isPushEnabled,
  setPushEnabled,
  registerForPushNotifications,
  unregisterPushNotifications,
} from '../../../src/lib/notifications';
import { useAppTheme } from '../../../src/theme/useAppTheme';

type PermissionStatus = 'granted' | 'denied' | 'undetermined';

export default function PushPreferencesScreen() {
  const { colors } = useAppTheme();
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('undetermined');
  const [enabled, setEnabled] = useState(isPushEnabled());
  const [isBusy, setIsBusy] = useState(false);

  const refreshPermissionStatus = useCallback(async () => {
    const { status } = await Notifications.getPermissionsAsync();
    setPermissionStatus(status as PermissionStatus);
  }, []);

  // Re-check OS permission status whenever the screen regains focus --
  // covers the user granting/revoking it from system settings and coming back.
  useFocusEffect(
    useCallback(() => {
      void refreshPermissionStatus();
    }, [refreshPermissionStatus]),
  );

  const handleToggle = async (next: boolean) => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      if (next) {
        setPushEnabled(true);
        setEnabled(true);
        const token = await registerForPushNotifications();
        await refreshPermissionStatus();
        if (!token) {
          // Permission was denied at the OS level -- the in-app toggle can't
          // override that, direct the user to system settings instead.
          setEnabled(false);
          setPushEnabled(false);
        }
      } else {
        setPushEnabled(false);
        setEnabled(false);
        await unregisterPushNotifications();
      }
    } finally {
      setIsBusy(false);
    }
  };

  const permissionBlocked = permissionStatus === 'denied';

  return (
    <SafeAreaView className="flex-1 bg-light-background dark:bg-surface" edges={['top']}>
      <View className="flex-row items-center px-4 py-3 border-b border-light-border dark:border-white/5">
        <TouchableOpacity
          onPress={() => router.back()}
          className="mr-3 p-1"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={22} color="#25D366" />
        </TouchableOpacity>
        <Text className="text-light-text-primary dark:text-white font-semibold text-base flex-1">Push Notifications</Text>
      </View>

      <View className="p-4">
        {permissionBlocked && (
          <TouchableOpacity
            className="bg-light-card dark:bg-surface-card border border-amber-500/30 rounded-2xl p-4 mb-4 flex-row items-start gap-3"
            onPress={() => void Linking.openSettings()}
            activeOpacity={0.8}
          >
            <Ionicons name="alert-circle-outline" size={20} color="#f59e0b" style={{ marginTop: 1 }} />
            <View className="flex-1">
              <Text className="text-light-text-primary dark:text-white font-semibold text-sm mb-1">
                Notifications are blocked
              </Text>
              <Text className="text-light-text-muted dark:text-white/50 text-xs leading-4">
                {Platform.OS === 'ios' ? 'iOS' : 'Android'} settings are blocking push
                notifications for VerzChat. Tap here to open Settings and allow them.
              </Text>
            </View>
          </TouchableOpacity>
        )}

        <View className="bg-light-card dark:bg-surface-card rounded-2xl border border-light-border dark:border-white/5 overflow-hidden">
          <View className="flex-row items-center px-4 py-4 gap-3">
            <View className="w-7 h-7 rounded-lg items-center justify-center bg-green/20">
              <Ionicons name="notifications-outline" size={15} color="#25D366" />
            </View>
            <View className="flex-1 min-w-0">
              <Text className="text-light-text-primary dark:text-white text-sm font-medium">Push Notifications</Text>
              <Text className="text-light-text-muted dark:text-white/40 text-xs mt-0.5">
                New messages, mentions, and alerts on this device
              </Text>
            </View>
            <Switch
              value={enabled && !permissionBlocked}
              onValueChange={(next) => void handleToggle(next)}
              disabled={isBusy || permissionBlocked}
              trackColor={{ false: colors.border, true: '#25D366' }}
              thumbColor="#fff"
            />
          </View>
        </View>

        <Text className="text-light-text-disabled dark:text-white/30 text-xs mt-4 px-1 leading-4">
          Turning this off stops new push notifications from being sent to this device. You'll
          still see everything in the Notifications tab and Inbox.
        </Text>
      </View>
    </SafeAreaView>
  );
}
