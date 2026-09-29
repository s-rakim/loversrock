// The floating nav.
//
// Adapted from a web component (framer-motion, Tailwind, lucide) that cannot
// run here: this app is React Native, not Next.js, so there is no className,
// no `layoutId`, no CSS `blur-2xl` and no `calc()`. What survives the port is
// the idea, which is the part worth having:
//
//   * a floating pill rather than a bar welded to the bottom edge
//   * a soft glow that SLIDES between tabs instead of appearing under the new
//     one, so the eye follows it
//   * the active icon larger than the rest, and growing into it
//   * a label that appears on the active tab only
//
// Three things had to be solved rather than translated.
//
// THE GLOW. `blur-2xl` has no equivalent; a real blur here would mean a
// BlurView per frame, which is expensive and cannot be driven by the native
// animation thread. Instead it is a stack of concentric rounded views at
// decreasing opacity — the same trick a designer uses for a soft shadow, and
// indistinguishable at this size.
//
// THE SLIDE. The web version animates `left` with a percentage. Layout
// properties cannot use the native driver, so every frame would cross the
// bridge and the slide would stutter under load — which is exactly when you
// notice it. This animates `translateX` between measured tab centres instead,
// which does run natively.
//
// THE MEASUREMENT. Percentages assume every tab is the same width. They are,
// here, but only because the labels are short; a longer one in another
// language would silently misalign the glow. So the row is measured on layout
// and the glow is positioned from real coordinates.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Easing, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import Icon from './Icon';
import Icon3D from './Icon3D';
import VoiceMic, { MIC_SIZE } from './voice/VoiceMic';
import { useGlass } from './GlassContext';
import { radius, spacing } from '../theme';
import { useTheme } from './ThemeContext';

// Six buttons, two of which are sections rather than single screens: Photos
// holds the camera, the wall and the thread; Play holds the drawings and the
// arcade. Things that are one activity belong behind one button, and six is
// the point where a floating pill still reads as a pill.
//
// Each tab has the same 3D icon as its tile on Home (components/Icon3D.js),
// so the bar reads as part of the same app. The line glyphs are kept as the
// fallback for anything without one.
const TAB_META = {
  Photos: { icon: 'camera-outline', iconActive: 'camera', icon3d: 'camera', label: 'Photos' },
  Play: { icon: 'color-wand-outline', iconActive: 'color-wand', icon3d: 'game', label: 'Play' },
  Home: { icon: 'home-outline', iconActive: 'home', icon3d: 'house', label: 'Home' },
  Cycle: { icon: 'water-outline', iconActive: 'water', icon3d: 'calendar', label: 'Cycle' },
  Quiz: { icon: 'help-circle-outline', iconActive: 'help-circle', icon3d: 'quiz', label: 'Quiz' },
  Settings: { icon: 'settings-outline', iconActive: 'settings', icon3d: 'gear', label: 'Settings' },
};

/**
 * The tab names, exported.
 *
 * App.js needs this list too, to decide whether a notification's target is a
 * tab or a stack screen — and a second hardcoded copy of it is exactly the
 * kind of list that goes stale the next time the tabs change, with the only
 * symptom being that one notification stops opening anything.
 */
export const TAB_ROUTES = Object.keys(TAB_META);

const GLOW = 64;

// The bar's own height: the 44px tab slots, the row's vertical padding and
// the pill's border. Kept in step with the styles below by the nav test.
const BAR_HEIGHT = 44 + 8 * 2 + 2;
const BAR_GAP = 12;

// THE BULGE. The voice mic sits in the middle of the bar and rises out of
// it, with the pill's top edge swelling up around it. HUMP is how far the
// swell rises above the pill; HUMP_HALF_WIDTH is half its footprint on the
// pill's top edge. The mic's centre sits MIC_DROP below that edge, so the
// swell hugs the top of the button with a few pixels to spare.
const HUMP = 16;
const HUMP_HALF_WIDTH = 46;
const MIC_DROP = 16;

/**
 * The bar's measurements at a size (Settings > Bottom bar size). Everything
 * above is its designed size, at scale 1; this is the one place that scales
 * it, so the drawn outline, the swell, the mic and the clearance every screen
 * leaves for the bar can never disagree about how big it is.
 */
export function barGeometry(scale = 1) {
  return {
    scale,
    // The one-pixel border top and bottom does not scale.
    height: (BAR_HEIGHT - 2) * scale + 2,
    hump: HUMP * scale,
    humpHalf: HUMP_HALF_WIDTH * scale,
    micDrop: MIC_DROP * scale,
    glow: GLOW * scale,
  };
}

/**
 * The bar's outline: the pill, with a smooth swell in the top edge at `cx`.
 *
 * Drawn rather than composed from views, because two overlapping
 * translucent shapes show a darker band where they meet, and a pill plus a
 * circle can only make a keyhole, not a swell. y = 0 is the top of the
 * swell; the pill itself runs from HUMP to HUMP + BAR_HEIGHT.
 */
export function barOutline(width, cx, inset = 0.5, g = barGeometry()) {
  const top = g.hump + inset;
  const bottom = g.hump + g.height - inset;
  const r = (bottom - top) / 2;
  const left = inset;
  const right = width - inset;
  const hw = g.humpHalf;
  return [
    `M ${left + r} ${top}`,
    `L ${cx - hw} ${top}`,
    `C ${cx - hw * 0.5} ${top} ${cx - hw * 0.55} ${inset} ${cx} ${inset}`,
    `C ${cx + hw * 0.55} ${inset} ${cx + hw * 0.5} ${top} ${cx + hw} ${top}`,
    `L ${right - r} ${top}`,
    `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
    `L ${left + r} ${bottom}`,
    `A ${r} ${r} 0 0 1 ${left + r} ${top}`,
    'Z',
  ].join(' ');
}

/** Just the swell, closed along the pill's top edge — the part the pill does not already cover. */
export function humpOutline(cx, g = barGeometry()) {
  const hw = g.humpHalf;
  const hump = g.hump;
  return [
    `M ${cx - hw} ${hump}`,
    `C ${cx - hw * 0.5} ${hump} ${cx - hw * 0.55} 0.5 ${cx} 0.5`,
    `C ${cx + hw * 0.55} 0.5 ${cx + hw * 0.5} ${hump} ${cx + hw} ${hump}`,
    'Z',
  ].join(' ');
}

/**
 * The colour expo-blur paints on Android, where it does not blur by default
 * and draws a flat tint instead (expo-blur's getBackgroundColor). The swell
 * has to be the same colour as the pill to read as one shape.
 */
function glassFill(intensity, isDark) {
  const opacity = (intensity / 100) * 0.78;
  return isDark ? `rgba(25,25,25,${opacity})` : `rgba(249,249,249,${opacity})`;
}

/**
 * How much of the bottom of the screen the floating bar covers.
 *
 * The bar floats OVER the screens rather than taking layout space from them,
 * so every screen that scrolls or pins something to its bottom edge has to
 * leave this much room itself. Screens used to guess — `paddingBottom: 140`
 * here, 32 there — and the cycle tracker guessed 32, which put its last card
 * and its own inner tab bar underneath this one.
 *
 * Derived from the real safe-area inset, because the bar sits above it: on a
 * phone with a gesture strip the inset is ~34px, with three-button navigation
 * it can be 48, and a constant is wrong on one of them.
 */
/**
 * Screens inside a tab that take the whole screen: the bar steps aside while
 * one is open. The chat is one — a message box wants the bottom of the screen,
 * and back from it goes to the camera, where the bar is again.
 */
export const BAR_HIDDEN_ON = new Set(['Messages']);

export function useBarClearance({ barHidden = false } = {}) {
  const insets = useSafeAreaInsets();
  // At whatever size the bar is set to, so a bigger bar never covers a
  // screen's last row or its message box.
  const { barScale } = useGlass();
  const g = barGeometry(barScale);
  const bottom = Math.max(insets.bottom, spacing.sm);
  if (barHidden) return { above: bottom, content: bottom + spacing.lg };
  return {
    // Where something floating above the bar should sit — above the swell
    // around the mic too, which rises past the pill.
    above: bottom + g.height + g.hump + BAR_GAP,
    // What a scrolling screen should pad its content by, so the last row can
    // be scrolled clear of the bar rather than resting behind it.
    content: bottom + g.height + BAR_GAP * 2,
  };
}

/** The soft light under the active tab, built without a blur filter. */
function Glow({ colors, size = GLOW }) {
  return (
    <View pointerEvents="none" style={styles.glowStack}>
      {[
        { size, opacity: 0.18 },
        { size: size * 0.74, opacity: 0.22 },
        { size: size * 0.5, opacity: 0.28 },
      ].map((ring) => (
        <View
          key={ring.size}
          style={{
            position: 'absolute',
            width: ring.size,
            height: ring.size,
            borderRadius: ring.size / 2,
            backgroundColor: colors.accent,
            opacity: ring.opacity,
          }}
        />
      ))}
    </View>
  );
}

export default function LumaBar({ state, navigation }) {
  const { colors, font, reduceMotion, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { intensity, barScale } = useGlass();
  const g = useMemo(() => barGeometry(barScale), [barScale]);
  const styles2 = useMemo(() => makeStyles(colors, font, barScale), [colors, font, barScale]);

  // Measured, not assumed — see the note on measurement above.
  const [centres, setCentres] = useState([]);
  const slide = useRef(new Animated.Value(0)).current;
  const grow = useRef(new Animated.Value(1)).current;

  const target = centres[state.index];

  // The pill's width and the mic slot's centre, both measured: the swell is
  // drawn at the slot, and the slot moves with the phone's width.
  const [pillWidth, setPillWidth] = useState(0);
  const [micCentre, setMicCentre] = useState(null);
  // Half-way along the tabs: three either side of the mic.
  const micIndex = Math.ceil(state.routes.length / 2);
  const openVoiceNotes = () => navigation.navigate('VoiceNotes');
  const fill = glassFill(intensity, isDark);
  const android = Platform.OS === 'android';

  useEffect(() => {
    if (target == null) return;
    if (reduceMotion) {
      slide.setValue(target);
      return;
    }
    Animated.spring(slide, {
      toValue: target,
      // Matches the web version's spring closely enough that the two feel
      // like the same component.
      stiffness: 500,
      damping: 30,
      mass: 1,
      useNativeDriver: true,
    }).start();
  }, [target, slide, reduceMotion]);

  // A small pulse on the icon each time the tab changes, which is what the
  // web version gets free from `animate={{ scale }}` on the active button.
  useEffect(() => {
    if (reduceMotion) return undefined;
    grow.setValue(0.8);
    const anim = Animated.timing(grow, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.back(2)),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [state.index, grow, reduceMotion]);

  // After every hook, so hiding never changes the order React sees them in.
  const inner = getFocusedRouteNameFromRoute(state.routes[state.index]);
  if (inner && BAR_HIDDEN_ON.has(inner)) return null;

  return (
    <View
      style={[styles2.wrapper, { bottom: Math.max(insets.bottom, spacing.sm) }]}
      pointerEvents="box-none"
    >
      {pillWidth > 0 && micCentre != null && (
        <Svg
          pointerEvents="none"
          width={pillWidth}
          height={g.height + g.hump}
          style={[styles.shape, { top: -g.hump }]}
        >
          {/* Android draws the whole shape here and the pill stays clear, so
              there is no seam between pill and swell. iOS keeps its real
              blur in the pill and only the swell is painted. */}
          <Path d={android ? barOutline(pillWidth, micCentre, 0, g) : humpOutline(micCentre, g)} fill={fill} />
        </Svg>
      )}
      <BlurView
        intensity={android ? 0 : intensity}
        tint={isDark ? 'dark' : 'light'}
        style={[styles2.pill, android ? styles.clearPill : styles.clearBorder]}
        onLayout={(e) => setPillWidth(e.nativeEvent.layout.width)}
      >
        {target != null && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.glowWrap,
              { width: g.glow, transform: [{ translateX: Animated.subtract(slide, g.glow / 2) }] },
            ]}
          >
            <Glow colors={colors} size={g.glow} />
          </Animated.View>
        )}

        <View style={styles2.row}>
          {withMicSlot(micIndex, (
            <View
              key="voice-mic-slot"
              style={styles2.tab}
              onLayout={(e) => {
                const { x, width } = e.nativeEvent.layout;
                // +1: the row sits inside the pill's one-pixel border.
                const centre = x + width / 2 + 1;
                setMicCentre((prev) => (prev === centre ? prev : centre));
              }}
            />
          ), state.routes.map((route, index) => {
            const meta = TAB_META[route.name]
              || { icon: 'ellipse-outline', iconActive: 'ellipse', label: route.name };
            const focused = state.index === index;

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={meta.label}
                onLayout={(e) => {
                  const { x, width } = e.nativeEvent.layout;
                  const centre = x + width / 2;
                  setCentres((prev) => {
                    if (prev[index] === centre) return prev;
                    const next = [...prev];
                    next[index] = centre;
                    return next;
                  });
                }}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress', target: route.key, canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
                }}
                style={styles2.tab}
              >
                <Animated.View style={focused ? { transform: [{ scale: grow }] } : null}>
                  {meta.icon3d ? (
                    // The one you are on is full size and full colour; the
                    // rest a little smaller and softer, so which tab you are
                    // on still reads at a glance without the glyphs' tint.
                    <Icon3D
                      name={meta.icon3d}
                      size={(focused ? 30 : 24) * barScale}
                      style={focused ? null : { opacity: 0.72 }}
                    />
                  ) : (
                    <Icon
                      name={focused ? meta.iconActive : meta.icon}
                      color={focused ? colors.accent : colors.textMuted}
                      size={(focused ? 24 : 20) * barScale}
                      chip={false}
                    />
                  )}
                </Animated.View>
                {/* The label only on the active tab. Six labels at once is a
                    bar; one is a caption, and it keeps the pill narrow enough
                    to float. */}
                {focused && <Text style={styles2.label} numberOfLines={1}>{meta.label}</Text>}
              </Pressable>
            );
          }))}
        </View>
      </BlurView>

      {pillWidth > 0 && micCentre != null && (
        <>
          {/* The outline over everything, so the swell and the pill share
              one continuous edge instead of the pill's own border cutting
              straight through the bottom of the swell. */}
          <Svg pointerEvents="none" width={pillWidth} height={g.height + g.hump} style={[styles.shape, { top: -g.hump }]}>
            <Path d={barOutline(pillWidth, micCentre, 0.5, g)} fill="none" stroke={colors.glassBorder} strokeWidth={1} />
          </Svg>
          {/* The mic keeps its own layout size and is scaled about its
              centre, so it stays centred in the swell at any bar size and
              its touch area scales with it. */}
          <VoiceMic
            onTap={openVoiceNotes}
            // The recording hint lives inside the scaled mic, so its offset
            // is given in the mic's own (unscaled) units.
            overlayBottom={(MIC_SIZE * barScale + (g.hump - (MIC_SIZE * barScale / 2 - g.micDrop)) + BAR_GAP) / barScale}
            style={[styles.mic, {
              left: micCentre - MIC_SIZE / 2,
              top: g.micDrop - MIC_SIZE / 2,
              transform: [{ scale: barScale }],
            }]}
          />
        </>
      )}
    </View>
  );
}

/** The tabs with the (empty) mic slot spliced in at `index`, so the tabs either side space evenly around it. */
function withMicSlot(index, slot, tabs) {
  return [...tabs.slice(0, index), slot, ...tabs.slice(index)];
}

const styles = StyleSheet.create({
  glowWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowStack: { alignItems: 'center', justifyContent: 'center' },
  // The drawn outline and fill, lined up with the pill: the swell rises
  // above the pill's top edge by the bar's hump (set where it is drawn).
  shape: { position: 'absolute', left: 0 },
  // On Android the drawn shape is the fill, and the drawn outline is the
  // border — the pill keeps its border width (the bar's height depends on it)
  // but paints neither.
  clearPill: { backgroundColor: 'transparent', borderColor: 'transparent' },
  clearBorder: { borderColor: 'transparent' },
  mic: { position: 'absolute' },
});

const makeStyles = (colors, font, scale = 1) =>
  StyleSheet.create({
    wrapper: {
      position: 'absolute',
      left: spacing.sm,
      right: spacing.sm,
      alignItems: 'stretch',
    },
    pill: {
      borderRadius: radius.pill,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.glassBorder,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOpacity: 0.16,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 10 },
        },
        android: { elevation: 10 },
      }),
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 6,
      paddingVertical: spacing.sm * scale,
    },
    // Seven tabs have to fit inside a pill that still floats, so each one is
    // a flexible slot rather than a fixed width: on a narrow phone they
    // squeeze evenly instead of the last one falling off the end.
    tab: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 2,
      height: 44 * scale,
      gap: 1,
    },
    label: {
      ...font.muted,
      fontSize: Math.max(9, 9 * scale),
      fontWeight: '800',
      letterSpacing: 0.3,
      color: colors.accent,
    },
  });
