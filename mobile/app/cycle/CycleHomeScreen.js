// The cycle tracker shell.
//
// The reference app puts the whole tracker behind its own bottom bar —
// Today · Calendar · (+) · Partner · Analysis — rather than mixing it into
// the app's main tabs, and this does the same. It is deliberately not a
// nested navigator: the app's floating glass tab bar already owns the bottom
// of the screen on the main tabs, and stacking a second navigator's bar on
// top of it fought for the same space. A plain state switch through
// <CrossFade> also gives the tab change a glide instead of a cut.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { CrossFade, MorphButton, Pop } from '../../components/Motion';
import { useCycle, todayDateString } from '../../components/cycle/CycleContext';

import CycleTodayScreen from './CycleTodayScreen';
import CycleCalendarScreen from './CycleCalendarScreen';
import CycleAnalysisScreen from './CycleAnalysisScreen';
import PartnerCycleScreen from './PartnerCycleScreen';

const TABS = [
  { key: 'today', label: 'Today', icon: 'flower' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
  { key: 'partner', label: 'Partner', icon: 'heart' },
  { key: 'analysis', label: 'Analysis', icon: 'stats-chart' },
];

function Shell({ navigation }) {
  const { colors, font } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { loading, error } = useCycle();
  const [tab, setTab] = useState('today');

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accentPink} size="large" />
        <Text style={[font.muted, { marginTop: spacing.sm }]}>Loading your cycle…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.textSecondary} />
        <Text style={[font.body, { marginTop: spacing.sm, textAlign: 'center' }]}>{error}</Text>
        <Text style={[font.muted, { marginTop: spacing.xs, textAlign: 'center' }]}>
          Check the server address in Settings and pull back in.
        </Text>
      </View>
    );
  }

  // The bar splits around the raised add button, exactly like the reference.
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  return (
    <View style={styles.root}>
      <CrossFade activeKey={tab}>
        {(shown) => (
          <View style={{ flex: 1 }}>
            {shown === 'today' && <CycleTodayScreen navigation={navigation} onGoToTab={setTab} />}
            {shown === 'calendar' && <CycleCalendarScreen navigation={navigation} />}
            {shown === 'partner' && <PartnerCycleScreen navigation={navigation} />}
            {shown === 'analysis' && <CycleAnalysisScreen navigation={navigation} />}
          </View>
        )}
      </CrossFade>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {left.map((t) => (
          <TabButton key={t.key} tab={t} active={tab === t.key} onPress={() => setTab(t.key)} />
        ))}

        <MorphButton
          onPress={() => navigation.navigate('CycleDailyLog', { date: todayDateString() })}
          style={styles.fab}
        >
          <Ionicons name="add" size={30} color="#fff" />
        </MorphButton>

        {right.map((t) => (
          <TabButton key={t.key} tab={t} active={tab === t.key} onPress={() => setTab(t.key)} />
        ))}
      </View>
    </View>
  );
}

function TabButton({ tab, active, onPress }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Pressable onPress={onPress} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: active }}>
      <Pop active={active}>
        <View style={[styles.tabPill, active && { backgroundColor: colors.tabBarActivePill }]}>
          <Ionicons
            name={active ? tab.icon : `${tab.icon}-outline`}
            size={20}
            color={active ? colors.accentPink : colors.textSecondary}
          />
        </View>
      </Pop>
      <Text style={[font.muted, styles.tabLabel, active && { color: colors.textPrimary, fontWeight: '600' }]}>
        {tab.label}
      </Text>
    </Pressable>
  );
}

export default function CycleHomeScreen({ navigation }) {
  return <Shell navigation={navigation} />;
}

const makeStyles = (colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    centered: {
      flex: 1, backgroundColor: 'transparent',
      alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
    },
    bar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-around',
      paddingTop: spacing.sm,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    tab: { alignItems: 'center', flex: 1 },
    tabPill: {
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
      borderRadius: radius.pill,
    },
    tabLabel: { fontSize: 11, marginTop: 2 },
    fab: {
      width: 58, height: 58, borderRadius: 29,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.accentPink,
      marginBottom: spacing.sm,
      shadowColor: colors.accentPink,
      shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
  });
