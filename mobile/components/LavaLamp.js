import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, AppState, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useTheme } from './ThemeContext';
import { BACKGROUND_SPEEDS, blobStops } from '../theme';
import useGravity, { UP_DEFAULT } from './useGravity';

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

function Blob({ spec, colour, opacity, diameter, width, height, animate, speedFactor, stops, up }) {
  // One driver per blob, looping 0 -> 1 -> 0. Interpolating it onto both axes
  // with different ranges traces an ellipse rather than a straight line.
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) {
      progress.stopAnimation();
      progress.setValue(0.5); // mid-drift, so a paused field still looks composed
      return undefined;
    }

    // Calm stretches every period, Lively compresses it. Multiplying rather
    // than replacing keeps the deliberately mismatched periods mismatched,
    // which is what stops the whole field pulsing in unison.
    const period = spec.period * speedFactor;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: period,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: period,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [animate, progress, spec.period, speedFactor]);

  // Travel is expressed against GRAVITY rather than against the screen.
  //
  // `up` is real-world up in screen coordinates; the perpendicular of it is
  // the sideways wander. A blob's long axis of travel is the rise, and its
  // short one the drift across, so turning the phone turns the whole field
  // with it instead of leaving the lava running sideways.
  //
  // Held upright this reduces exactly to what it replaced: up is (0, -1), the
  // perpendicular is (1, 0), and the ranges come out as the old
  // driftX-across, driftY-up pair.
  const perp = { x: -up.y, y: up.x };
  const span = Math.max(width, height) * 0.5;
  const vecX = (up.x * spec.driftY + perp.x * spec.driftX) * span;
  const vecY = (up.y * spec.driftY + perp.y * spec.driftX) * span;

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-vecX, vecX],
  });
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-vecY, vecY],
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
          {/* Where the colour stops is the whole look, and it is now a
              setting rather than three hardcoded numbers. Low definition
              starts fading almost at once and reads as smoke; high holds
              full strength nearly to the rim and reads as an actual blob.
              The outermost stop is always transparent — a hard cut at 100%
              has nothing to anti-alias against and shimmers as it moves. */}
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset={`${stops.core}%`} stopColor={colour} stopOpacity={opacity} />
            <Stop offset={`${stops.mid}%`} stopColor={colour} stopOpacity={opacity * stops.midAlpha} />
            <Stop offset="100%" stopColor={colour} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={diameter / 2} cy={diameter / 2} r={diameter / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

export default function LavaLamp() {
  const {
    colors, isDark, reduceMotion, backgroundIntensity, backgroundSpeed, backgroundDefinition,
  } = useTheme();
  const { width, height } = useWindowDimensions();
  // Anything that is not explicitly backgrounded counts as active.
  //
  // This used to be `AppState.currentState === 'active'`, which is false on
  // Android at first render: currentState is 'unknown' until the native module
  // reports in. The listener below only fires on a CHANGE, and an app that
  // launches straight into the foreground never changes — so `active` stayed
  // false forever and the background never moved. It would start drifting if
  // you backgrounded the app and came back, which is the sort of detail that
  // makes a bug look like a mystery.
  const [active, setActive] = React.useState(AppState.currentState !== 'background');

  // A drifting background is pure cost while nobody is looking at it.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setActive(state !== 'background' && state !== 'inactive');
    });
    return () => sub.remove();
  }, []);

  const animate = active && !reduceMotion;

  // Which way the lava rises. Not polled while the field is not animating:
  // a sensor running behind a still background is battery for nothing, and
  // somebody who asked the OS for less movement did not ask for a background
  // that swings when they turn over in bed.
  const up = useGravity(animate);

  // Recomputed only when the setting moves, not per blob per frame.
  const stops = useMemo(() => blobStops(backgroundDefinition), [backgroundDefinition]);

  const base = Math.max(width, height);

  // Only ever dims. The palette's blobOpacity is the value every contrast
  // figure in test/theme.mjs is measured at, so turning it UP would quietly
  // push the app's own body text under 4.5:1.
  const intensity = Math.min(1, Math.max(0.3, backgroundIntensity ?? 1));
  const speedFactor = BACKGROUND_SPEEDS[backgroundSpeed]?.factor ?? 1;

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
          opacity={colors.blobOpacity * intensity}
          diameter={base * 0.55 * spec.size}
          width={width}
          height={height}
          animate={animate}
          speedFactor={speedFactor}
          stops={stops}
          up={animate ? up : UP_DEFAULT}
        />
      ))}
    </View>
  );
}
