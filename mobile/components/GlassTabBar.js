import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './Icon';
import { useGlass } from './GlassContext';
import { colors, radius, spacing, font } from '../theme';

const TAB_META = {
  Home: { icon: 'home-outline', iconActive: 'home', label: 'Home' },
  Games: { icon: 'game-controller-outline', iconActive: 'game-controller', label: 'Arcade' },
  Messages: { icon: 'chatbubble-outline', iconActive: 'chatbubble', label: 'Messages' },
  Memories: { icon: 'images-outline', iconActive: 'images', label: 'Memories' },
  Settings: { icon: 'settings-outline', iconActive: 'settings', label: 'Settings' },
};

// A floating "liquid glass" bottom tab bar: a frosted BlurView pill whose
// blur intensity is user-adjustable (see SettingsScreen + GlassContext),
// so the opacity of the glass effect is a real, persisted preference.
export default function GlassTabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  const { intensity } = useGlass();

  return (
    <View style={[styles.wrapper, { bottom: Math.max(insets.bottom, spacing.md) }]} pointerEvents="box-none">
      <BlurView intensity={intensity} tint="light" style={styles.blur}>
        <View style={styles.row}>
          {state.routes.map((route, index) => {
            const meta = TAB_META[route.name] || { icon: 'ellipse-outline', iconActive: 'ellipse', label: route.name };
            const focused = state.index === index;

            return (
              <Pressable
                key={route.key}
                onPress={() => {
                  const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
                }}
                style={styles.tab}
              >
                <Icon
                  name={focused ? meta.iconActive : meta.icon}
                  color={focused ? '#fff' : colors.textMuted}
                  size={20}
                  chip
                  chipSize={36}
                  chipColor={focused ? colors.accent : 'transparent'}
                />
                <Text style={[styles.label, focused && styles.labelActive]}>{meta.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
  },
  blur: {
    flexDirection: 'row',
    width: '100%',
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.glassBorder,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 8 },
    }),
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.sm,
  },
  tab: { alignItems: 'center', gap: 2 },
  label: { ...font.muted, fontSize: 11 },
  labelActive: { color: colors.accent, fontWeight: '700' },
});
