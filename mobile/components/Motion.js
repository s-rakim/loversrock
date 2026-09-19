// Moti + react-native-reanimated were tried first and removed after causing
// a crash ("Cannot read property 'useContext' of null" / "Invalid hook
// call") — Moti pulled in a second, conflicting React context tree. This
// file replicates the small slice of Moti's from/animate/transition API
// this app actually uses, built entirely on React Native's own Animated.Value
// + Animated.timing/spring. Zero extra dependencies, so it cannot hit that
// crash class again.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { colors } from '../theme';
import { useTheme } from './ThemeContext';

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

/**
 * Staggered entrance for a list of cards. Each child gets its own FadeInUp
 * with a growing delay, so a screen assembles itself instead of snapping in
 * all at once. Honours the reduce-motion preference — with it on, children
 * render plainly with no delay at all.
 */
export function Stagger({ children, delayStep = 60, initialDelay = 0, distance = 18 }) {
  const { reduceMotion } = useTheme();
  const items = React.Children.toArray(children);
  if (reduceMotion) return <>{items}</>;
  return (
    <>
      {items.map((child, i) => (
        <FadeInUp key={child.key ?? i} delay={initialDelay + i * delayStep} distance={distance}>
          {child}
        </FadeInUp>
      ))}
    </>
  );
}

/**
 * Cross-fades between sibling views keyed by `activeKey` — the cycle
 * tracker's own tab bar swaps Today/Calendar/Analysis through this, so the
 * switch glides rather than cutting. The outgoing view is unmounted only
 * after the fade completes, which is what stops the flash of background.
 */
export function CrossFade({ activeKey, children, duration = 220, slide = 10 }) {
  const { reduceMotion } = useTheme();
  const [shown, setShown] = useState(activeKey);
  const opacity = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (activeKey === shown) return;
    if (reduceMotion) {
      setShown(activeKey);
      return;
    }
    let cancelled = false;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: duration / 2, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -slide, duration: duration / 2, useNativeDriver: true }),
    ]).start(() => {
      if (cancelled) return;
      setShown(activeKey);
      translateY.setValue(slide);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: duration / 2, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 160 }),
      ]).start();
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, reduceMotion]);

  return (
    <Animated.View style={{ flex: 1, opacity, transform: [{ translateY }] }}>
      {typeof children === 'function' ? children(shown) : children}
    </Animated.View>
  );
}

/**
 * Height + opacity reveal, for the symptom groups' accordions. Height cannot
 * run on the native driver, so opacity is animated on its own value that can.
 */
export function Collapse({ open, children, duration = 240 }) {
  const { reduceMotion } = useTheme();
  const [height, setHeight] = useState(0);
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const opacity = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(open ? 1 : 0);
      opacity.setValue(open ? 1 : 0);
      return;
    }
    Animated.parallel([
      Animated.timing(progress, { toValue: open ? 1 : 0, duration, useNativeDriver: false }),
      Animated.timing(opacity, { toValue: open ? 1 : 0, duration, useNativeDriver: true }),
    ]).start();
  }, [open, reduceMotion, duration, progress, opacity]);

  return (
    <Animated.View
      style={{ overflow: 'hidden', height: progress.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) }}
    >
      <Animated.View
        style={{ opacity, position: 'absolute', left: 0, right: 0, top: 0 }}
        onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Spring scale between two states — the selected/unselected pop on a chip.
 * Kept separate from MorphButton because this tracks a value, not a press.
 */
export function Pop({ active, children, style, activeScale = 1.06 }) {
  const { reduceMotion } = useTheme();
  const scale = useRef(new Animated.Value(active ? activeScale : 1)).current;

  useEffect(() => {
    if (reduceMotion) { scale.setValue(1); return; }
    Animated.spring(scale, {
      toValue: active ? activeScale : 1,
      useNativeDriver: true,
      damping: 11,
      stiffness: 220,
    }).start();
  }, [active, reduceMotion, activeScale, scale]);

  return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
}

/**
 * Animates a bar/segment width from 0 to `value` (0..1). Width is a layout
 * property, so this one cannot use the native driver either.
 */
export function GrowBar({ value, duration = 700, style, children }) {
  const { reduceMotion } = useTheme();
  const progress = useRef(new Animated.Value(reduceMotion ? value : 0)).current;

  useEffect(() => {
    if (reduceMotion) { progress.setValue(value); return; }
    Animated.timing(progress, { toValue: value, duration, useNativeDriver: false }).start();
  }, [value, reduceMotion, duration, progress]);

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return <Animated.View style={[style, { width }]}>{children}</Animated.View>;
}

/**
 * Wraps a screen so it fades and lifts in every time it gains focus.
 *
 * bottom-tabs v6 swaps tab scenes with no animation of its own, so without
 * this a tab change is a hard cut. Focus-driven rather than mount-driven,
 * because tab screens stay mounted once visited.
 */
export function fadeOnFocus(Screen, { duration = 240, distance = 12 } = {}) {
  function Focusable(props) {
    const isFocused = useIsFocused();
    const { reduceMotion } = useTheme();
    const opacity = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(distance)).current;

    useEffect(() => {
      if (!isFocused) return;
      if (reduceMotion) {
        opacity.setValue(1);
        translateY.setValue(0);
        return;
      }
      opacity.setValue(0);
      translateY.setValue(distance);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 180 }),
      ]).start();
    }, [isFocused, reduceMotion, opacity, translateY]);

    return (
      <Animated.View style={{ flex: 1, opacity, transform: [{ translateY }] }}>
        <Screen {...props} />
      </Animated.View>
    );
  }
  Focusable.displayName = `fadeOnFocus(${Screen.displayName || Screen.name || 'Screen'})`;
  return Focusable;
}

export default { AnimatedBox, FadeInUp, MorphButton, ProgressDot, PulsingText, Stagger, CrossFade, Collapse, Pop, GrowBar, fadeOnFocus };
