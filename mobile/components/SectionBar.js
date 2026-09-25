// The inner nav: the pill that switches between the screens inside one tab.
//
// Photos holds the camera, the wall and the thread; Play holds the drawings
// and the arcade. Both needed a way to move between their own screens, and
// none of the obvious places worked:
//
//   * A header with a back arrow is wrong. These are siblings, not a
//     drill-down — you do not "go back" from the camera to the wall.
//   * A second bottom bar under LumaBar is two floating pills stacked, which
//     reads as a mistake.
//   * A bar rendered OUTSIDE the section's navigator disappears the moment
//     you navigate, because a native-stack screen is opaque and paints over
//     anything its parent drew.
//
// So the bar lives INSIDE each screen, which is what `withSectionBar` is
// for: it wraps a screen component and puts the pill above it. Every screen
// in the section renders its own copy, they look identical, and the native
// stack's slide animation carries the bar along with the content instead of
// leaving it hanging.
//
// It borrows LumaBar's language deliberately — same blur, same border, same
// sliding light under the active item — so the two read as the same system
// at two levels rather than as two different navigations.
import React, { useMemo, useRef, useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon, { outlineOf } from './Icon';
import { useGlass } from './GlassContext';
import { radius, spacing } from '../theme';
import { useTheme } from './ThemeContext';

// The gap between the pill's edge and the items inside it, shared by the
// row's padding and the sliding light so the two cannot disagree.
const INSET = 4;

/**
 * The switcher itself.
 *
 * `items` is [{ key, icon, label }]; `active` is one of those keys. Every
 * item is `flex: 1`, which is not only for looks: equal widths mean the
 * light behind the active item is a constant-width view that only ever
 * MOVES, so its slide can run on the native driver. Animating a width would
 * put every frame back on the JS thread.
 */
export function SectionBar({ items, active, onSelect }) {
  const { colors, font, reduceMotion, isDark } = useTheme();
  const { intensity } = useGlass();
  const styles = useMemo(() => makeStyles(colors, font), [colors, font]);

  const [rowWidth, setRowWidth] = useState(0);
  const slide = useRef(new Animated.Value(0)).current;

  const index = Math.max(0, items.findIndex((item) => item.key === active));
  // onLayout reports the row INCLUDING its own padding, but the items are
  // laid out inside it — so the track the light slides along is the row
  // minus that padding on both sides. Off by those few pixels and the light
  // drifts further from the item it is under with every step across.
  const track = Math.max(0, rowWidth - INSET * 2);
  const cell = items.length ? track / items.length : 0;
  const target = cell * index;

  useEffect(() => {
    if (!cell) return;
    if (reduceMotion) {
      slide.setValue(target);
      return;
    }
    Animated.spring(slide, {
      toValue: target,
      stiffness: 500,
      damping: 30,
      mass: 1,
      useNativeDriver: true,
    }).start();
  }, [target, cell, slide, reduceMotion]);

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <BlurView intensity={intensity} tint={isDark ? 'dark' : 'light'} style={styles.pill}>
        <View
          style={styles.row}
          onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
        >
          {cell > 0 && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.highlight,
                { width: cell, transform: [{ translateX: slide }] },
              ]}
            />
          )}

          {items.map((item) => {
            const focused = item.key === active;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={item.label}
                onPress={() => { if (!focused) onSelect(item.key); }}
                style={styles.item}
              >
                <Icon
                  name={focused ? item.icon : outlineOf(item.icon)}
                  color={focused ? colors.accent : colors.textMuted}
                  size={focused ? 18 : 16}
                  chip={false}
                />
                {/* Unlike LumaBar, every label shows. There are only two or
                    three of them, and inside a section the labels are the
                    only thing telling you what the section contains. */}
                <Text
                  style={[styles.label, focused && styles.labelActive]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}

/**
 * Wrap a screen so it renders the section's pill above itself.
 *
 * The wrapped screen is handed the SAME props it would have had, so it keeps
 * its own `navigation` and `route` — nothing inside it needs to know it has
 * been wrapped.
 *
 * The one thing that does change is the safe-area inset it sees. The bar
 * already covers the notch, so the screen below it is told `top: 0`;
 * otherwise every screen that pads for the status bar would pad a second
 * time and open a gap under the pill. That override is scoped to this
 * subtree, so the same screen rendered anywhere else is unaffected.
 */
export function withSectionBar(Component, items, activeKey) {
  function Wrapped(props) {
    const insets = useSafeAreaInsets();
    const inner = useMemo(() => ({ ...insets, top: 0 }), [insets]);

    return (
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <SectionBar
          items={items}
          active={activeKey}
          onSelect={(key) => props.navigation.navigate(key)}
        />
        <SafeAreaInsetsContext.Provider value={inner}>
          <View style={{ flex: 1 }}>
            <Component {...props} />
          </View>
        </SafeAreaInsetsContext.Provider>
      </View>
    );
  }

  Wrapped.displayName = `withSectionBar(${Component.displayName || Component.name || 'Screen'})`;
  return Wrapped;
}

const makeStyles = (colors, font) =>
  StyleSheet.create({
    wrapper: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
    },
    pill: {
      borderRadius: radius.pill,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.glassBorder,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOpacity: 0.1,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        },
        android: { elevation: 6 },
      }),
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: INSET,
    },
    highlight: {
      position: 'absolute',
      left: INSET,
      top: INSET,
      bottom: INSET,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
    },
    item: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      height: 36,
      paddingHorizontal: INSET,
    },
    label: {
      ...font.muted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.2,
      color: colors.textMuted,
    },
    labelActive: { color: colors.accent },
  });

export default SectionBar;
