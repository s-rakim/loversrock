// Moti + react-native-reanimated were tried first and removed after causing
// a crash ("Cannot read property 'useContext' of null" / "Invalid hook
// call") — Moti pulled in a second, conflicting React context tree. This
// file replicates the small slice of Moti's from/animate/transition API
// this app actually uses, built entirely on React Native's own Animated.Value
// + Animated.timing/spring. Zero extra dependencies, so it cannot hit that
// crash class again.
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable } from 'react-native';
import { colors } from '../theme';

const ANIMATABLE_KEYS = ['opacity', 'translateX', 'translateY', 'scale'];

function buildValues(from) {
  const values = {};
  for (const key of ANIMATABLE_KEYS) {
    if (from[key] !== undefined) values[key] = new Animated.Value(from[key]);
  }
  return values;
}

export function AnimatedBox({ from = {}, animate = {}, transition = {}, style, children, ...rest }) {
  const valuesRef = useRef(buildValues({ ...defaultsFor(animate), ...from }));
  const values = valuesRef.current;

  useEffect(() => {
    const { type = 'timing', duration = 350, delay = 0, damping = 14, stiffness = 120 } = transition;

    const animations = Object.keys(animate)
      .filter((key) => values[key] !== undefined)
      .map((key) => {
        const target = animate[key];
        if (type === 'spring') {
          return Animated.spring(values[key], {
            toValue: target,
            delay,
            damping,
            stiffness,
            useNativeDriver: true,
          });
        }
        return Animated.timing(values[key], {
          toValue: target,
          duration,
          delay,
          useNativeDriver: true,
        });
      });

    Animated.parallel(animations).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(animate), JSON.stringify(transition)]);

  const transform = [];
  if (values.translateX !== undefined) transform.push({ translateX: values.translateX });
  if (values.translateY !== undefined) transform.push({ translateY: values.translateY });
  if (values.scale !== undefined) transform.push({ scale: values.scale });

  return (
    <Animated.View
      style={[
        style,
        values.opacity !== undefined ? { opacity: values.opacity } : null,
        transform.length ? { transform } : null,
      ]}
      {...rest}
    >
      {children}
    </Animated.View>
  );
}

function defaultsFor(animate) {
  const defaults = {};
  if (animate.opacity !== undefined) defaults.opacity = 1;
  if (animate.translateX !== undefined) defaults.translateX = 0;
  if (animate.translateY !== undefined) defaults.translateY = 0;
  if (animate.scale !== undefined) defaults.scale = 1;
  return defaults;
}

export function FadeInUp({ delay = 0, distance = 20, children, style }) {
  return (
    <AnimatedBox
      from={{ opacity: 0, translateY: distance }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 400, delay }}
      style={style}
    >
      {children}
    </AnimatedBox>
  );
}

export function MorphButton({ onPress, style, children, disabled }) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () =>
    Animated.spring(scale, { toValue: 0.94, useNativeDriver: true, speed: 30 }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20 }).start();

  return (
    <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} disabled={disabled}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

export function ProgressDot({ active, size = 8 }) {
  const scale = useRef(new Animated.Value(active ? 1 : 0.8)).current;
  const colorProgress = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: active ? 1.3 : 0.8, useNativeDriver: true, speed: 20 }),
      Animated.timing(colorProgress, { toValue: active ? 1 : 0, duration: 250, useNativeDriver: false }),
    ]).start();
  }, [active]);

  const backgroundColor = colorProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, colors.accent],
  });

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor,
        transform: [{ scale }],
      }}
    />
  );
}

export function PulsingText({ children, style, minOpacity = 0.4 }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: minOpacity, duration: 900, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return <Animated.Text style={[style, { opacity }]}>{children}</Animated.Text>;
}

export default { AnimatedBox, FadeInUp, MorphButton, ProgressDot, PulsingText };
