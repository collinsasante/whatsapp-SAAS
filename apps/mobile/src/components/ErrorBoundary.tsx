import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colorScheme } from 'nativewind';

// Class component (can't use the useAppTheme hook), so it reads NativeWind's
// vanilla colorScheme API directly -- same source of truth, just not a hook.
function currentColors() {
  const isDark = colorScheme.get() !== 'light';
  return isDark
    ? { background: '#0d1117', textPrimary: '#ffffff', textMuted: 'rgba(255,255,255,0.4)' }
    : { background: '#ffffff', textPrimary: '#0f172a', textMuted: '#94a3b8' };
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error.message, info.componentStack?.slice(0, 300));
  }

  render() {
    if (this.state.hasError) {
      const colors = currentColors();
      return (
        <View
          style={{
            flex: 1,
            backgroundColor: colors.background,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
          }}
        >
          <Ionicons name="warning-outline" size={48} color="#f97316" style={{ marginBottom: 16 }} />
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 20,
              fontWeight: '700',
              marginBottom: 8,
              textAlign: 'center',
            }}
          >
            Something went wrong
          </Text>
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 13,
              textAlign: 'center',
              marginBottom: 32,
              lineHeight: 20,
            }}
          >
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </Text>
          <TouchableOpacity
            style={{
              backgroundColor: '#25D366',
              borderRadius: 12,
              paddingVertical: 14,
              paddingHorizontal: 32,
            }}
            onPress={() => this.setState({ hasError: false, error: null })}
            activeOpacity={0.8}
          >
            <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 15 }}>
              Try Again
            </Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}
