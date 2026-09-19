import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, AppState, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useTheme } from './ThemeContext';

/**
 * The animated background that sits behind every screen.
 *
 * Seven large, soft-edged blobs drift on slow sine paths over the theme's
 * gradient; where they overlap their glows add up, which is what reads as a
 * lava lamp. In the dark theme a scatter of static stars sits behind them.
 *
 * On the technique: the spec asked for Skia blobs merged with a colour-matrix
 * threshold and driven by Reanimated. Skia 1.x declares react-native-reanimated
 * as a peer dependency, and Reanimated is the library this project removed
 * after it crashed the app with a duplicate React context tree (README, "A note
 * on the animation library"). react-native-svg is already here but Expo SDK 51
 * pins 15.2.0, which predates its filter primitives - so no FeGaussianBlur or
 * FeColorMatrix either. Radial gradients with a transparent outer stop give the
 * soft edge instead, and overlapping alpha gives the merge. Every blob is an
 * Animated.View transform, so the motion runs on the native driver and the JS
 * thread stays free.
 */

// Fractions of the screen, so the layout holds on any device. Each blob has
// its own drift distance and period; the mismatched periods are what stop the
// whole field pulsing in unison.
const BLOBS = [
  { x: 0.10, y: 0.12, size: 1.15, driftX: 0.18, driftY: 0.10, period: 17000, tone: 0 },
  { x: 0.82, y: 0.08, size: 0.95, driftX: -0.14, driftY: 0.16, period: 21000, tone: 1 },
  { x: 0.50, y: 0.34, size: 1.35, driftX: 0.12, driftY: -0.12, period: 26000, tone: 2 },
  { x: 0.16, y: 0.58, size: 1.05, driftX: 0.20, driftY: -0.08, period: 19000, tone: 3 },
  { x: 0.88, y: 0.52, size: 1.20, driftX: -0.18, driftY: -0.14, period: 23000, tone: 0 },
  { x: 0.34, y: 0.86, size: 1.00, driftX: 0.16, driftY: 0.12, period: 29000, tone: 1 },
  { x: 0.74, y: 0.92, size: 1.10, driftX: -0.12, driftY: 0.10, period: 15000, tone: 2 },
];

const STARS = [
  [0.12, 0.08, 1.2], [0.28, 0.17, 0.9], [0.44, 0.06, 1.4], [0.62, 0.14, 1.0],
  [0.79, 0.05, 1.3], [0.91, 0.19, 0.8], [0.07, 0.29, 1.1], [0.36, 0.33, 0.8],
  [0.55, 0.26, 1.2], [0.85, 0.35, 1.0], [0.20, 0.44, 0.9], [0.68, 0.47, 1.1],
  [0.95, 0.58, 0.9], [0.04, 0.62, 1.2], [0.47, 0.55, 0.8],
];

function Blob({ spec, colour, opacity, diameter, width, height, animate }) {
  // One driver per blob, looping 0 -> 1 -> 0. Interpolating it onto both axes
  // with different ranges traces an ellipse rather than a straight line.
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) {
      progress.stopAnimation();
      progress.setValue(0.5); // mid-drift, so a paused field still looks composed
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: spec.period,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: spec.period,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [animate, progress, spec.period]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-spec.driftX * width * 0.5, spec.driftX * width * 0.5],
  });
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [spec.driftY * height * 0.5, -spec.driftY * height * 0.5],
  });

  const id = `blob-${spec.x}-${spec.y}`;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: spec.x * width - diameter / 2,
        top: spec.y * height - diameter / 2,
        width: diameter,
        height: diameter,
        transform: [{ translateX }, { translateY }],
      }}
    >
      <Svg width={diameter} height={diameter}>
        <Defs>
          {/* Opaque core fading to fully transparent gives the soft edge that
              a Gaussian blur would otherwise provide. */}
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={colour} stopOpacity={opacity} />
            <Stop offset="55%" stopColor={colour} stopOpacity={opacity * 0.55} />
            <Stop offset="100%" stopColor={colour} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={diameter / 2} cy={diameter / 2} r={diameter / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

export default function LavaLamp() {
  const { colors, isDark, reduceMotion } = useTheme();
  const { width, height } = useWindowDimensions();
  const [active, setActive] = React.useState(AppState.currentState === 'active');

  // A drifting background is pure cost while nobody is looking at it.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);

  const animate = active && !reduceMotion;
  const base = Math.max(width, height);

  const stars = useMemo(
    () =>
      STARS.map(([x, y, r], i) => (
        <Circle key={i} cx={x * width} cy={y * height} r={r} fill="#FFFFFF" fillOpacity={0.55} />
      )),
    [width, height]
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={colors.backgroundGradient} style={StyleSheet.absoluteFill} />

      {isDark && (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          {stars}
        </Svg>
      )}

      {BLOBS.map((spec) => (
        <Blob
          key={`${spec.x}-${spec.y}`}
          spec={spec}
          colour={colors.blobs[spec.tone % colors.blobs.length]}
          opacity={colors.blobOpacity}
          diameter={base * 0.55 * spec.size}
          width={width}
          height={height}
          animate={animate}
        />
      ))}
    </View>
  );
}
