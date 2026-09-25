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
import Icon from './Icon';
import { useGlass } from './GlassContext';
import { radius, spacing } from '../theme';
import { useTheme } from './ThemeContext';

const TAB_META = {
  Home: { icon: 'home-outline', iconActive: 'home', label: 'Home' },
  Locket: { icon: 'camera-outline', iconActive: 'camera', label: 'Locket' },
  Doodle: { icon: 'brush-outline', iconActive: 'brush', label: 'Doodle' },
  Games: { icon: 'game-controller-outline', iconActive: 'game-controller', label: 'Arcade' },
  Messages: { icon: 'chatbubble-outline', iconActive: 'chatbubble', label: 'Chat' },
  Cycle: { icon: 'water-outline', iconActive: 'water', label: 'Cycle' },
  Settings: { icon: 'settings-outline', iconActive: 'settings', label: 'Settings' },
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

/** The soft light under the active tab, built without a blur filter. */
function Glow({ colors }) {
  return (
    <View pointerEvents="none" style={styles.glowStack}>
      {[
        { size: GLOW, opacity: 0.18 },
        { size: GLOW * 0.74, opacity: 0.22 },
        { size: GLOW * 0.5, opacity: 0.28 },
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
  const styles2 = useMemo(() => makeStyles(colors, font), [colors, font]);
  const insets = useSafeAreaInsets();
  const { intensity } = useGlass();

  // Measured, not assumed — see the note on measurement above.
  const [centres, setCentres] = useState([]);
  const slide = useRef(new Animated.Value(0)).current;
  const grow = useRef(new Animated.Value(1)).current;

  const target = centres[state.index];

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

  return (
    <View
      style={[styles2.wrapper, { bottom: Math.max(insets.bottom, spacing.sm) }]}
      pointerEvents="box-none"
    >
      <BlurView intensity={intensity} tint={isDark ? 'dark' : 'light'} style={styles2.pill}>
        {target != null && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.glowWrap,
              { transform: [{ translateX: Animated.subtract(slide, GLOW / 2) }] },
            ]}
          >
            <Glow colors={colors} />
          </Animated.View>
        )}

        <View style={styles2.row}>
          {state.routes.map((route, index) => {
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
                  <Icon
                    name={focused ? meta.iconActive : meta.icon}
                    color={focused ? colors.accent : colors.textMuted}
                    size={focused ? 24 : 20}
                    chip={false}
                  />
                </Animated.View>
                {/* The label only on the active tab. Six labels at once is a
                    bar; one is a caption, and it keeps the pill narrow enough
                    to float. */}
                {focused && <Text style={styles2.label} numberOfLines={1}>{meta.label}</Text>}
              </Pressable>
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  glowWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: GLOW,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowStack: { alignItems: 'center', justifyContent: 'center' },
});

const makeStyles = (colors, font) =>
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
      paddingVertical: spacing.sm,
    },
    // Seven tabs have to fit inside a pill that still floats, so each one is
    // a flexible slot rather than a fixed width: on a narrow phone they
    // squeeze evenly instead of the last one falling off the end.
    tab: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 2,
      height: 44,
      gap: 1,
    },
    label: {
      ...font.muted,
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.3,
      color: colors.accent,
    },
  });
