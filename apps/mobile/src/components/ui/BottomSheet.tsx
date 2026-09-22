import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  type ViewProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/useAppTheme';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Cap sheet height for long, scrollable content (e.g. a list inside). */
  maxHeightPct?: number;
}

/** The Modal + dimmed backdrop + rounded-t-3xl sheet pattern used across ~10 screens. */
export function BottomSheet({ visible, onClose, title, children, maxHeightPct }: BottomSheetProps) {
  const { colors } = useAppTheme();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end"
      >
        <TouchableOpacity
          className="absolute inset-0"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          activeOpacity={1}
          onPress={onClose}
        />
        <View
          className="bg-light-card dark:bg-surface rounded-t-3xl"
          style={maxHeightPct ? { maxHeight: `${maxHeightPct}%` } : undefined}
        >
          {title && (
            <View className="flex-row items-center justify-between px-5 py-4 border-b border-light-border dark:border-white/5">
              <Text className="text-light-text-primary dark:text-white font-bold text-lg">{title}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface SheetActionProps extends ViewProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

/** A single tappable row inside a BottomSheet action menu. */
export function SheetAction({ icon, label, onPress, destructive }: SheetActionProps) {
  const { colors } = useAppTheme();
  const color = destructive ? '#ef4444' : colors.textPrimary;
  return (
    <TouchableOpacity className="flex-row items-center gap-3 py-3 px-5" onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={18} color={color} />
      <Text className="text-sm" style={{ color }}>{label}</Text>
    </TouchableOpacity>
  );
}
