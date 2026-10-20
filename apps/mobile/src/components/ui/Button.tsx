import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/useAppTheme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type Variant = 'primary' | 'secondary' | 'destructive' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: IoniconName;
  fullWidth?: boolean;
}

const VARIANT_STYLE: Record<Variant, { container: string; text: string }> = {
  primary: { container: 'bg-green', text: 'text-white' },
  secondary: { container: 'bg-light-card dark:bg-surface-card border border-light-border dark:border-white/10', text: 'text-light-text-primary dark:text-white' },
  destructive: { container: 'border border-red/30', text: 'text-red-400' },
  ghost: { container: '', text: 'text-light-text-secondary dark:text-white/60' },
};

export function Button({ label, onPress, variant = 'primary', loading, disabled, icon, fullWidth }: ButtonProps) {
  const { colors } = useAppTheme();
  const style = VARIANT_STYLE[variant];
  const isDisabled = disabled || loading;
  const iconColor = variant === 'destructive' ? '#f87171' : variant === 'primary' ? '#fff' : colors.textPrimary;

  return (
    <TouchableOpacity
      className={`rounded-xl py-3.5 items-center justify-center flex-row gap-2 ${style.container} ${fullWidth ? 'w-full' : ''} ${isDisabled ? 'opacity-50' : ''}`}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : '#25D366'} size="small" />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={17} color={iconColor} />}
          <Text className={`font-bold text-sm ${style.text}`}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export function IconButton({
  icon,
  onPress,
  color,
  size = 22,
}: {
  icon: IoniconName;
  onPress: () => void;
  color?: string;
  size?: number;
}) {
  const { colors } = useAppTheme();
  return (
    <TouchableOpacity onPress={onPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} className="p-1">
      <Ionicons name={icon} size={size} color={color ?? colors.textSecondary} />
    </TouchableOpacity>
  );
}
