// Animated gradient borders — a light that moves around the edge of a card.
//
// PORTING NOTE, because this looks like a port and is not one.
//
// The originals are web components (Next.js + Tailwind + shadcn): a sliding
// `ShineBorder` and a much larger `BeamBorder` built from conic gradients,
// `@property` registrations, `mask-composite`, CSS `filter: blur()/hue-rotate()`
// and `::before`/`::after` pseudo-elements, driven by CSS keyframes and a
// requestAnimationFrame loop over CSS custom properties.
//
// React Native has none of that. No DOM, no pseudo-elements, no CSS at all —
// no conic gradient, no mask-composite, no blur filter, no custom properties,
// and `requestAnimationFrame` here drives the JS thread rather than the
// compositor. Dropping those files in would not compile, and there is no
// shadcn or Tailwind to install into an Expo app that would change that.
//
// So the EFFECT is rebuilt with what this platform does have:
//
//   shine — a wide multi-stop gradient slides behind a clipped rounded box.
//           The content sits on top inset by the border width, so what stays
//           visible is a ring, and the ring appears to travel.
//
//   beam  — the same idea with rotation instead of translation: an oversized
//           gradient square spins behind the card. Through a thin ring that
//           reads as a beam going around the edge, which is what the conic
//           version achieves with `from var(--angle)`.
//
//   pulse — a breathing glow. The web version blurs; there is no cheap blur
//           here, so it is an opacity and scale oscillation on a soft
//           gradient, which is the part of that effect the eye actually reads.
//
// ONE CLOCK FOR THE WHOLE APP. Every instance interpolates from a single
// module-level Animated.Value instead of owning a loop. A screen can show a
// dozen of these, and a dozen independent drivers is a dozen things to
// schedule every frame. Each card takes a `phase` so they are not in lockstep,
// which costs nothing. The native driver runs all of it off the JS thread.
import React, { useMemo, useState } from 'react';
import { View, StyleSheet, Animated, Easing, AppState } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { radius as radii } from '../theme';
import { useTheme } from './ThemeContext';

/** The shared clock: 0 -> 1, forever. */
const clock = new Animated.Value(0);
let loop = null;

function startClock() {
  if (loop) return;
  loop = Animated.loop(
    Animated.timing(clock, {
      toValue: 1,
      duration: 6000,
      easing: Easing.linear,   // a shine that eases reads as a glitch
      useNativeDriver: true,
    })
  );
  loop.start();
}

function stopClock() {
  loop?.stop();
  loop = null;
}

// A moving light nobody is looking at is pure battery.
//
// Guarded for the same reason as every other module-scope call in this app:
// a decorative border is not worth the app failing to launch over.
try {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') startClock();
    else stopClock();
  });
} catch {
  /* The light just keeps running; it is a shine on a border. */
}

export const SHINE_COLORS = ['#A07CFE', '#FE8FB5', '#FFBE7B'];

export default function ShineBorder({
  children,
  colors: shineColors,
  variant = 'shine',       // 'shine' | 'beam' | 'pulse'
  borderWidth = 1.5,
  radius = radii.card,
  phase = 0,
  // A card that is merely present does not need to shine. `active` lets a
  // screen light up the one thing that matters — your turn, something new —
  // rather than everything at once, which is just noise that costs frames.
  active = true,
  background,
  style,
  contentStyle,
}) {
  const { colors, reduceMotion } = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });

  const palette = shineColors || SHINE_COLORS;
  const surface = background ?? colors.surface;
  const animated = active && !reduceMotion;

  if (animated && size.width > 0) startClock();

  // Repeated so the strip tiles: [a,b,c] -> [a,b,c,a,b,c,a]. Sliding by
  // exactly one copy lands on an identical frame, so the loop has no seam.
  const stops = useMemo(() => [...palette, ...palette, palette[0]], [palette]);

  const layer = useMemo(() => {
    if (!size.width) return null;

    if (variant === 'beam') {
      // The card's diagonal, so a rotating square still covers the corners.
      const span = Math.ceil(Math.hypot(size.width, size.height)) * 1.3;
      const rotate = clock.interpolate({
        inputRange: [0, 1],
        outputRange: [`${phase * 360}deg`, `${phase * 360 + 360}deg`],
      });
      return (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: (size.width - span) / 2,
            top: (size.height - span) / 2,
            width: span,
            height: span,
            transform: animated ? [{ rotate }] : [{ rotate: `${phase * 360}deg` }],
          }}
        >
          <LinearGradient
            colors={stops}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      );
    }

    if (variant === 'pulse') {
      // No blur available, so the breathing is carried by opacity and scale —
      // which is the part of the web version's glow the eye reads anyway.
      const cycle = clock.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0, 1, 0],
      });
      return (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            animated
              ? {
                opacity: cycle.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
                transform: [{ scale: cycle.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
              }
              : { opacity: 0.8 },
          ]}
        >
          <LinearGradient
            colors={palette}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      );
    }

    // 'shine'
    const translateX = clock.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -size.width],
    });
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            width: size.width * 3,
            transform: animated
              ? [{ translateX }, { translateX: -size.width * phase }]
              : [{ translateX: -size.width * phase }],
          },
        ]}
      >
        <LinearGradient
          colors={stops}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    );
  }, [variant, size.width, size.height, stops, palette, phase, animated]);

  return (
    <View
      style={[{ borderRadius: radius, overflow: 'hidden', padding: borderWidth }, style]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      }}
    >
      {layer}
      <View
        style={[
          {
            // The inner radius must shrink by the border width, or the ring
            // bunches up into a thick blob at each corner.
            borderRadius: Math.max(0, radius - borderWidth),
            backgroundColor: surface,
            overflow: 'hidden',
          },
          contentStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

/** The rotating-beam variant, as its own name since that is how it reads. */
export function BeamBorder(props) {
  return <ShineBorder variant="beam" {...props} />;
}

/** The breathing variant. */
export function PulseBorder(props) {
  return <ShineBorder variant="pulse" {...props} />;
}
