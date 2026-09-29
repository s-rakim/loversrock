// The live sky behind every screen: the two of you on a bench, above the
// Golden Gate or across the river from New York, under the sky it is outside
// right now.
//
// Each scene is one foreground (the view, the bench, the two of you as a
// silhouette) and its sky, rendered by scripts/build-sky.py as a picture for
// every twenty minutes in which the light changes — dawn, day, sunset, the
// blue hour, night and the full moon, and every mix in between
// (skyFrames.js). The light glides from each picture to the next over those
// twenty minutes, evenly, so it never visibly steps. Nothing in the scene
// moves; the sky drifts slowly on its own, and stars come out as it darkens.
//
// Everything that moves is a transform or an opacity on the native driver,
// all of it following one clock that runs in real time.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTheme } from './ThemeContext';
import { SKY_FRAMES, SKY_TIMELINE } from './skyFrames';

export const SCENES = ['goldengate', 'newyork'];

// The layers' own sizes (build-sky.py): the foreground, and each sky, which
// is wider than the foreground so it can drift, and sits on its top edge.
const GROUND = { w: 624, h: 1200 };
const SKY = { w: 1040, h: 760 };
const HORIZON = 690;

// How often the clock is looked at. Between looks the light keeps gliding
// towards where it will be at the next one.
const LOOK = 20 * 1000;
const HOUR = 60 * 60 * 1000;

// Local midnight before `date`, in milliseconds.
const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const hourOf = (date) => date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600
  + date.getMilliseconds() / HOUR;

/**
 * Where the clock is: the row of the timeline it is in (`row`), pictures `a`
 * and `b` either side of it (indexes into SKY_FRAMES), `t` from 0 (all a) to
 * 1 (all b), and how bright the stars are, 0 to 1. Local time, so it is the
 * sky outside your own window.
 */
export function skyAt(date = new Date()) {
  const h = hourOf(date);
  for (let i = 0; i < SKY_TIMELINE.length - 1; i += 1) {
    const [h0, a, s0] = SKY_TIMELINE[i];
    const [h1, b, s1] = SKY_TIMELINE[i + 1];
    if (h >= h0 && h < h1) {
      const x = (h - h0) / (h1 - h0);
      return { row: i, a, b, t: a === b ? 0 : x, stars: s0 + (s1 - s0) * x };
    }
  }
  const last = SKY_TIMELINE.length - 1;
  const [, a, stars] = SKY_TIMELINE[last];
  return { row: last - 1, a, b: a, t: 0, stars };
}

// The stars' brightness through the day, for the clock to read directly.
const STAR_HOURS = SKY_TIMELINE.map((r) => r[0]);
const STAR_LEVELS = SKY_TIMELINE.map((r) => r[2]);

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
 * `scene`: 'goldengate' or 'newyork'. `still`: no drift and no twinkle, for
 * the small previews in the wallpaper picker. `at` pins the scene to a time
 * of day (a Date), for the same.
 */
export default function SkyBackground({ scene = 'goldengate', still = false, at = null, veil = true }) {
  const win = useWindowDimensions();
  // Its own box, not the window: the same scene fills the whole app behind
  // every screen, the chat behind the thread, or a thumbnail in the picker.
  const [box, setBox] = useState(null);
  const width = box?.width || win.width;
  const height = box?.height || win.height;
  const { isDark, reduceMotion: systemStill } = useTheme();
  const reduceMotion = systemStill || still;
  const view = SCENES.includes(scene) ? scene : 'goldengate';
  // The time, in hours, running continuously — across midnight too, where
  // it carries on from 24 rather than jumping back to 0 — and every opacity
  // follows it. `now` is which pair of pictures is up, and the day it is in.
  const start = useRef(midnight(at || new Date())).current;
  const place = (d) => ({ ...skyAt(d), base: 24 * Math.round((midnight(d) - start) / (24 * HOUR)) });
  const [now, setNow] = useState(() => place(at || new Date()));
  const clock = useRef(new Animated.Value(now.base + hourOf(at || new Date()))).current;
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (at) {
      const here = place(at);
      setNow(here);
      clock.setValue(here.base + hourOf(at));
      return undefined;
    }
    let run = null;
    // Look at the clock, then glide evenly to where it will be at the next
    // look. A new pair of pictures only re-renders the layers; the light
    // itself never waits for that.
    const look = () => {
      const d = new Date();
      const here = place(d);
      setNow((was) => (was.row === here.row && was.base === here.base ? was : here));
      const value = here.base + hourOf(d);
      run?.stop();
      clock.setValue(value);
      run = Animated.timing(clock, { toValue: value + LOOK / HOUR, duration: LOOK, easing: Easing.linear, useNativeDriver: true });
      run.start();
    };
    look();
    const timer = setInterval(look, LOOK);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') look(); });
    return () => { clearInterval(timer); sub.remove(); run?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, clock]);

  // The sky drifts, slowly, back and forth: clouds and stars moving over a
  // still scene is what makes it read as live rather than a photo.
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
  // edge at the same scale, so the view and the horizon line up exactly.
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

  // The picture fading in covers the one underneath by exactly how far the
  // clock is between them. At the hand-over it is fully there, becomes the
  // one underneath (the same element, kept by its key), and the next starts
  // from nothing: no reset, so nothing can flicker.
  const h0 = now.base + SKY_TIMELINE[now.row][0];
  const h1 = now.base + SKY_TIMELINE[now.row + 1][0];
  const fadeIn = useMemo(
    () => clock.interpolate({ inputRange: [h0, h1], outputRange: [0, 1], extrapolate: 'clamp' }),
    [clock, h0, h1],
  );
  const starry = useMemo(
    () => clock.interpolate({ inputRange: STAR_HOURS.map((h) => now.base + h), outputRange: STAR_LEVELS, extrapolate: 'clamp' }),
    [clock, now.base],
  );
  const dark = SKY_TIMELINE[now.row][2] > 0 || (SKY_TIMELINE[now.row + 1]?.[2] ?? 0) > 0;

  const skyX = drift.interpolate({ inputRange: [0, 1], outputRange: [geo.left, geo.left - geo.travel] });
  const skyStyle = { position: 'absolute', top: geo.top, left: 0, width: geo.sw, height: geo.sh, transform: [{ translateX: skyX }] };
  const groundStyle = { position: 'absolute', top: geo.top, left: geo.left, width: geo.gw, height: geo.gh };
  const shown = now.a === now.b ? [now.a] : [now.a, now.b];
  const layer = (kind, style) => shown.map((f, i) => (
    <Animated.Image
      key={`${kind}${f}`}
      source={kind === 'sky' ? SKY_FRAMES[f].sky : SKY_FRAMES[f].ground[view]}
      style={[style, i ? { opacity: fadeIn } : null]}
      resizeMode="stretch"
      fadeDuration={0}
    />
  ));

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (w && h && (w !== box?.width || h !== box?.height)) setBox({ width: w, height: h });
      }}
    >
      {layer('sky', skyStyle)}

      {/* Stars, only once it is getting dark, only in the sky. */}
      {dark ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: starry }]}>
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
      ) : null}

      {layer('ground', groundStyle)}

      {/* Keeps the app's text readable over a bright sky: a light veil in the
          light theme, a dark one in the dark theme. */}
      {veil ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(8,6,20,0.38)' : 'rgba(255,250,252,0.22)' }]} />
      ) : null}
    </View>
  );
}
