// The live sky behind every screen: the two of you on the bench above the
// Golden Gate, under the sky it is outside right now.
//
// The scene is one foreground (bridge, hills, the bench, the two of you) and
// five skies — dawn, day, sunset, night and the full moon — built by
// scripts/build-sky.py from the pictures. The clock picks two of them and
// how far between them it is, and the sky and the relit foreground cross over
// together, so the light changes and nothing in the scene moves. On top of
// that the sky drifts slowly on its own, stars twinkle once it is dark, and
// the moon glows.
//
// Everything that moves is a transform or an opacity on the native driver:
// the JS thread only wakes once a minute to see where the clock has got to.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Easing, Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTheme } from './ThemeContext';

const LAYERS = {
  dawn: { sky: require('../assets/sky/dawn-sky.jpg'), ground: require('../assets/sky/dawn-ground.webp') },
  day: { sky: require('../assets/sky/day-sky.jpg'), ground: require('../assets/sky/day-ground.webp') },
  sunset: { sky: require('../assets/sky/sunset-sky.jpg'), ground: require('../assets/sky/sunset-ground.webp') },
  night: { sky: require('../assets/sky/night-sky.jpg'), ground: require('../assets/sky/night-ground.webp') },
  moon: { sky: require('../assets/sky/moon-sky.jpg'), ground: require('../assets/sky/moon-ground.webp') },
};

// The layers' own sizes (build-sky.py): the foreground, and each sky, which
// is wider than the foreground so it can drift, and sits on its top edge.
const GROUND = { w: 624, h: 1200 };
const SKY = { w: 1040, h: 760 };
const HORIZON = 690;

/**
 * The day, as [hour, phase] keyframes. Between two keyframes with different
 * phases the sky crosses from one to the other; between two with the same
 * phase it holds. Local time, so it is the sky outside your own window.
 */
export const DAY_KEYS = [
  [0, 'moon'], [3.5, 'moon'], [4.5, 'night'], [5.25, 'night'],
  [6.25, 'dawn'], [7, 'dawn'], [8, 'day'], [17, 'day'],
  [18.25, 'sunset'], [19, 'sunset'], [20, 'night'], [22, 'night'],
  [23.5, 'moon'], [24, 'moon'],
];

/** Where the clock is: phases `a` and `b`, and `t` from 0 (all a) to 1 (all b). */
export function skyAt(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  for (let i = 0; i < DAY_KEYS.length - 1; i += 1) {
    const [h0, a] = DAY_KEYS[i];
    const [h1, b] = DAY_KEYS[i + 1];
    if (h >= h0 && h < h1) {
      if (a === b) return { a, b, t: 0 };
      const x = (h - h0) / (h1 - h0);
      return { a, b, t: x * x * (3 - 2 * x) };   // ease in and out
    }
  }
  return { a: 'moon', b: 'moon', t: 0 };
}

const DARK = { night: 1, moon: 1 };
const darkness = ({ a, b, t }) => (DARK[a] || 0) * (1 - t) + (DARK[b] || 0) * t;

// Twinkling stars: a fixed scatter, so they do not jump about between visits.
const STARS = Array.from({ length: 34 }, (_, i) => {
  const r = (n) => {
    const x = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: r(1), y: r(2) * 0.8, size: 1.2 + r(3) * 1.8, period: 1800 + r(4) * 3200, delay: r(5) * 3000 };
});

function Star({ star, left, top, width, height, still }) {
  const glow = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    if (still) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(star.delay),
      Animated.timing(glow, { toValue: 1, duration: star.period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0.25, duration: star.period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [glow, star, still]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: left + star.x * width,
        top: top + star.y * height,
        width: star.size,
        height: star.size,
        borderRadius: star.size,
        backgroundColor: '#fff',
        opacity: glow,
      }}
    />
  );
}

/**
 * `still`: no drift and no twinkle, for the small previews in the wallpaper
 * picker. `at` pins the scene to a time of day (a Date), for the same.
 */
export default function SkyBackground({ still = false, at = null, veil = true }) {
  const win = useWindowDimensions();
  // Its own box, not the window: the same scene fills the whole app behind
  // every screen, the chat behind the thread, or a thumbnail in the picker.
  const [box, setBox] = useState(null);
  const width = box?.width || win.width;
  const height = box?.height || win.height;
  const { isDark, reduceMotion: systemStill } = useTheme();
  const reduceMotion = systemStill || still;
  const [phase, setPhase] = useState(() => skyAt(at || new Date()));
  const blend = useRef(new Animated.Value(phase.t)).current;
  const night = useRef(new Animated.Value(darkness(phase))).current;
  const drift = useRef(new Animated.Value(0)).current;

  // Once a minute, and whenever the app comes back to the front: where is
  // the clock? A change of phase pair swaps the layers; within a pair the
  // blend just moves on, gently.
  useEffect(() => {
    if (at) return undefined;
    const tick = () => setPhase(skyAt());
    const timer = setInterval(tick, 60 * 1000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') tick(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [at]);
  useEffect(() => {
    Animated.timing(blend, { toValue: phase.t, duration: 1500, useNativeDriver: true }).start();
    Animated.timing(night, { toValue: darkness(phase), duration: 1500, useNativeDriver: true }).start();
  }, [phase, blend, night]);

  // The sky drifts, slowly, back and forth: clouds and stars moving over a
  // still bridge is what makes it read as live rather than a photo.
  useEffect(() => {
    if (reduceMotion) { drift.setValue(0.5); return undefined; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 150000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 150000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [drift, reduceMotion]);

  // The foreground covers the screen and is centred; the sky sits on its top
  // edge at the same scale, so the bridge and the horizon line up exactly.
  const geo = useMemo(() => {
    const scale = Math.max(width / GROUND.w, height / GROUND.h);
    const gw = GROUND.w * scale;
    const gh = GROUND.h * scale;
    const left = (width - gw) / 2;
    const top = (height - gh) / 2;
    return {
      scale, left, top, gw, gh,
      sw: SKY.w * scale, sh: SKY.h * scale,
      travel: (SKY.w - GROUND.w) * scale,
      horizon: top + HORIZON * scale,
    };
  }, [width, height]);

  const skyX = drift.interpolate({ inputRange: [0, 1], outputRange: [geo.left, geo.left - geo.travel] });
  const skyStyle = { position: 'absolute', top: geo.top, left: 0, width: geo.sw, height: geo.sh, transform: [{ translateX: skyX }] };
  const groundStyle = { position: 'absolute', top: geo.top, left: geo.left, width: geo.gw, height: geo.gh };
  const { a, b } = phase;

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (w && h && (w !== box?.width || h !== box?.height)) setBox({ width: w, height: h });
      }}
    >
      <Animated.Image source={LAYERS[a].sky} style={skyStyle} resizeMode="stretch" fadeDuration={0} />
      {b !== a ? (
        <Animated.Image source={LAYERS[b].sky} style={[skyStyle, { opacity: blend }]} resizeMode="stretch" fadeDuration={0} />
      ) : null}

      {/* Stars, only once it is dark, only in the sky. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: night }]}>
        {STARS.map((star, i) => (
          <Star
            key={i}
            star={star}
            left={0}
            top={Math.max(0, geo.top)}
            width={width}
            height={Math.max(0, geo.horizon - Math.max(0, geo.top) - 40 * geo.scale)}
            still={reduceMotion}
          />
        ))}
      </Animated.View>

      <Image source={LAYERS[a].ground} style={groundStyle} resizeMode="stretch" fadeDuration={0} />
      {b !== a ? (
        <Animated.Image source={LAYERS[b].ground} style={[groundStyle, { opacity: blend }]} resizeMode="stretch" fadeDuration={0} />
      ) : null}

      {/* Keeps the app's text readable over a bright sky: a light veil in the
          light theme, a dark one in the dark theme. */}
      {veil ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(8,6,20,0.38)' : 'rgba(255,250,252,0.22)' }]} />
      ) : null}
    </View>
  );
}
