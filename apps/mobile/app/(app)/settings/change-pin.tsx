import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiClient } from '../../../src/lib/api';

const NUMPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

type PinStep = 'new' | 'confirm';

export default function ChangePinScreen() {
  const [step, setStep] = useState<PinStep>('new');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const currentValue = step === 'new' ? newPin : confirmPin;
  const setValue = step === 'new' ? setNewPin : setConfirmPin;

  const handleKey = (key: string) => {
    if (key === '⌫') {
      setValue((prev) => prev.slice(0, -1));
      return;
    }
    if (key === '' || currentValue.length >= 6) return;
    const next = currentValue + key;
    setValue(next);
    if (next.length === 6) {
      if (step === 'new') {
        setStep('confirm');
      } else {
        submitPinChange(newPin, next);
      }
    }
  };

  const submitPinChange = async (pin: string, confirm: string) => {
    if (pin !== confirm) {
      Alert.alert('Mismatch', 'PINs do not match. Please try again.');
      setStep('new');
      setNewPin('');
      setConfirmPin('');
      return;
    }
    setIsLoading(true);
    try {
      await apiClient.auth.changePin(undefined, pin);
      Alert.alert('PIN Updated', 'Your PIN has been changed successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not change PIN. Please try again.';
      Alert.alert('Error', msg);
      setStep('new');
      setNewPin('');
      setConfirmPin('');
    } finally {
      setIsLoading(false);
    }
  };

  const titles: Record<PinStep, string> = {
    new: 'Set New PIN',
    confirm: 'Confirm New PIN',
  };
  const subtitles: Record<PinStep, string> = {
    new: 'Enter a new 6-digit PIN.',
    confirm: 'Re-enter your new PIN to confirm.',
  };

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-4 py-3 border-b border-white/5">
        <TouchableOpacity onPress={() => router.back()} className="mr-3 p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text className="text-green text-base">←</Text>
        </TouchableOpacity>
        <Text className="text-white font-semibold text-base flex-1">Change PIN</Text>
      </View>

      <View className="flex-1 px-6 pt-10">
        <Text className="text-white text-2xl font-bold mb-2">{titles[step]}</Text>
        <Text className="text-white/60 text-base mb-10">{subtitles[step]}</Text>

        {/* PIN dots */}
        <View className="flex-row justify-center gap-4 mb-12">
          {Array.from({ length: 6 }).map((_, i) => (
            <View
              key={i}
              className={`w-4 h-4 rounded-full ${
                i < currentValue.length ? 'bg-green' : 'bg-white/20'
              }`}
            />
          ))}
        </View>

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#25D366" size="large" />
          </View>
        ) : (
          <View className="flex-row flex-wrap justify-center gap-4">
            {NUMPAD.map((key, i) => (
              <TouchableOpacity
                key={i}
                className={`w-20 h-16 rounded-2xl items-center justify-center ${
                  key === '' ? 'opacity-0' : 'bg-surface-card'
                }`}
                onPress={() => key !== '' && handleKey(key)}
                disabled={key === ''}
                activeOpacity={0.6}
              >
                <Text className="text-white text-2xl font-medium">{key}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
