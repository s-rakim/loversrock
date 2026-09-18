// A fluid celebratory burst (radiating hearts + sparkles) built entirely on
// React Native's Animated API — used for "both answered" / "correct guess"
// moments instead of a single static emoji. Re-plays whenever `trigger`
// changes, so callers just bump a counter/boolean to fire it again.
import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { HeartShape, SparkleShape } from './Stickers';
import { colors } from '../theme';

const PARTICLE_COUNT = 8;

function buildParticles() {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
    return {
      angle,
      distance: 60 + Math.random() * 30,
      type: i % 2 === 0 ? 'heart' : 'sparkle',
      size: 14 + Math.random() * 10,
      progress: new Animated.Value(0),
    };
  });
}

export default function CelebrationBurst({ trigger, size = 160 }) {
  const particlesRef = useRef(buildParticles());

  useEffect(() => {
    if (!trigger) return;
    particlesRef.current = buildParticles();
    const animations = particlesRef.current.map((p, i) =>
      Animated.sequence([
        Animated.delay(i * 20),
        Animated.timing(p.progress, { toValue: 1, duration: 650, useNativeDriver: true }),
      ])
    );
    Animated.parallel(animations).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  return (
    <View pointerEvents="none" style={[styles.container, { width: size, height: size }]}>
      {particlesRef.current.map((p, i) => {
        const translateX = p.progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, Math.cos(p.angle) * p.distance],
        });
        const translateY = p.progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, Math.sin(p.angle) * p.distance],
        });
        const scale = p.progress.interpolate({
          inputRange: [0, 0.3, 1],
          outputRange: [0, 1.2, 0.6],
        });
        const opacity = p.progress.interpolate({
          inputRange: [0, 0.15, 0.8, 1],
          outputRange: [0, 1, 1, 0],
        });
        const Shape = p.type === 'heart' ? HeartShape : SparkleShape;

        return (
          <Animated.View
            key={i}
            style={[
              styles.particle,
              { transform: [{ translateX }, { translateY }, { scale }], opacity },
            ]}
          >
            <Shape size={p.size} color={p.type === 'heart' ? colors.accent : colors.gold} />
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  particle: { position: 'absolute' },
});
