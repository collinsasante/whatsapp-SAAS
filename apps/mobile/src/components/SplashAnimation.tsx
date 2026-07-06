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

  // Three loading dots
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  // Container fade for exit
  const containerOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Entry: logo fades + scales in
    Animated.parallel([
      Animated.timing(logoOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, tension: 80, friction: 9, useNativeDriver: true }),
    ]).start(() => {
      // Dots bounce in sequence, looping
      const dotAnim = (dot: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(dot, { toValue: 1, duration: 280, useNativeDriver: true }),
            Animated.timing(dot, { toValue: 0, duration: 280, useNativeDriver: true }),
            Animated.delay(560),
          ]),
        );
      dotAnim(dot1, 0).start();
      dotAnim(dot2, 180).start();
      dotAnim(dot3, 360).start();
    });
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

  const dotStyle = (anim: Animated.Value) => ({
    opacity: anim,
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -6],
        }),
      },
    ],
  });

  return (
    <Animated.View style={[styles.container, { opacity: containerOpacity }]} pointerEvents="none">
      {/* Logo card */}
      <Animated.View
        style={[
          styles.logoCard,
          { opacity: logoOpacity, transform: [{ scale: logoScale }] },
        ]}
      >
        <Image
          source={require('../../assets/images/icon.png')}
          style={styles.logo}
          contentFit="contain"
        />
      </Animated.View>

      {/* Loading dots */}
      <Animated.View style={[styles.dotsRow, { opacity: logoOpacity }]}>
        <Animated.View style={[styles.dot, dotStyle(dot1)]} />
        <Animated.View style={[styles.dot, dotStyle(dot2)]} />
        <Animated.View style={[styles.dot, dotStyle(dot3)]} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    width,
    height,
    backgroundColor: '#0d1117',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  logoCard: {
    width: 108,
    height: 108,
    borderRadius: 24,
    backgroundColor: '#161b22',
    alignItems: 'center',
    justifyContent: 'center',
    // Green shadow glow
    shadowColor: '#25D366',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  logo: {
    width: 72,
    height: 72,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 32,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#25D366',
    opacity: 0.7,
  },
});
