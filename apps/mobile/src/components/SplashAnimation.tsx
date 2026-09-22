import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, StyleSheet, Dimensions } from 'react-native';
import { Image } from 'expo-image';

const { width, height } = Dimensions.get('window');

interface SplashAnimationProps {
  visible: boolean;
  onComplete?: () => void;
}

export function SplashAnimation({ visible, onComplete }: SplashAnimationProps) {
  const [mounted, setMounted] = useState(true);

  // Logo animation values
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.85)).current;

  // Container fade for exit
  const containerOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Entry: logo fades + scales in -- kept to a single, restrained motion,
    // no looping loading indicator.
    Animated.parallel([
      Animated.timing(logoOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, tension: 80, friction: 9, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    if (!visible) {
      // Exit: fade everything out
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => {
        setMounted(false);
        onComplete?.();
      });
    }
  }, [visible]);

  if (!mounted) return null;

  return (
    <Animated.View style={[styles.container, { opacity: containerOpacity }]} pointerEvents="none">
      <Animated.View
        style={{ opacity: logoOpacity, transform: [{ scale: logoScale }], alignItems: 'center' }}
      >
        <Image
          source={require('../../assets/images/verz-mark.png')}
          style={styles.logo}
          contentFit="contain"
        />
        <Image
          source={require('../../assets/images/verz-wordmark-dark.png')}
          style={styles.wordmark}
          contentFit="contain"
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    width,
    height,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  logo: {
    width: 64,
    height: 64,
  },
  wordmark: {
    width: 130,
    height: 29,
    marginTop: 16,
  },
});
