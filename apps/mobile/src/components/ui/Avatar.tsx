import React from 'react';
import { View, Text, Image } from 'react-native';
import { useAppTheme } from '../../theme/useAppTheme';

const AVATAR_COLORS = ['#25D366', '#3b82f6', '#8b5cf6', '#f97316', '#ec4899', '#14b8a6', '#eab308'];

// Deterministic per-name color so the same contact always gets the same
// avatar color across screens (matches web's "hashed color per name").
function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  const initials = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return initials.toUpperCase();
}

const SIZES = { xs: 28, sm: 36, md: 44, lg: 56, xl: 72 } as const;
export type AvatarSize = keyof typeof SIZES;

export interface AvatarProps {
  name: string;
  imageUrl?: string | null;
  size?: AvatarSize | number;
  online?: boolean;
}

export function Avatar({ name, imageUrl, size = 'md', online }: AvatarProps) {
  const { colors } = useAppTheme();
  const dimension = typeof size === 'number' ? size : SIZES[size];
  const dotSize = Math.max(10, Math.round(dimension * 0.28));

  return (
    <View style={{ width: dimension, height: dimension }}>
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={{ width: dimension, height: dimension, borderRadius: dimension / 2 }}
        />
      ) : (
        <View
          style={{
            width: dimension,
            height: dimension,
            borderRadius: dimension / 2,
            backgroundColor: colorForName(name) + '26',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: colorForName(name), fontWeight: '800', fontSize: dimension * 0.38 }}>
            {initialsFor(name)}
          </Text>
        </View>
      )}
      {online != null && (
        <View
          style={{
            position: 'absolute',
            bottom: -1,
            right: -1,
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: online ? '#25D366' : colors.textDisabled,
            borderWidth: 2,
            borderColor: colors.background,
          }}
        />
      )}
    </View>
  );
}
