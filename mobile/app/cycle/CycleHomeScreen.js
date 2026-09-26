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
import CyclePickRoleScreen from './CyclePickRoleScreen';

// The tabs differ by role, because the two sides are not the same product.
//
// The owner gets their own record, all of it editable, plus a Partner tab
// that previews what the other phone can see — useful precisely because it
// is the thing they are deciding about.
//
// The partner gets the shared view and the calendar reading from it. They do
// not get the daily log or the analysis: those are the owner's diary, and a
// tab that opens someone else's health record is not a tab.
const OWNER_TABS = [
  { key: 'today', label: 'Today', icon: 'flower' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
  { key: 'partner', label: 'Shared', icon: 'heart' },
  { key: 'analysis', label: 'Analysis', icon: 'stats-chart' },
];

const PARTNER_TABS = [
  { key: 'partner', label: 'Today', icon: 'heart' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
];

function Shell({ navigation }) {
  const { colors, font } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { loading, error, role } = useCycle();
  const tabs = role === 'partner' ? PARTNER_TABS : OWNER_TABS;
  const [tab, setTab] = useState(null);

  // The first tab of whichever set applies, rather than a hardcoded 'today':
  // the partner's set has no 'today', so hardcoding it rendered nothing.
  const active = tab && tabs.some((t) => t.key === tab) ? tab : tabs[0].key;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accentPink} size="large" />
        <Text style={[font.muted, { marginTop: spacing.sm }]}>Loading your cycle…</Text>
      </View>
    );
  }

  // Nobody has said which side of this they are on yet, so ask. Defaulting
  // would mean either a read-only screen for the person tracking, or someone
  // else's health record for the partner.
  if (!loading && !role) {
    return <CyclePickRoleScreen />;
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
  // The partner has no add button — there is nothing for them to log — so
  // their two tabs sit side by side instead of straddling a gap.
  const owner = role !== 'partner';
  const left = owner ? tabs.slice(0, 2) : tabs;
  const right = owner ? tabs.slice(2) : [];

  return (
    <View style={styles.root}>
      <CrossFade activeKey={active}>
        {(shown) => (
          <View style={{ flex: 1 }}>
            {shown === 'today' && <CycleTodayScreen navigation={navigation} onGoToTab={setTab} />}
            {shown === 'calendar' && <CycleCalendarScreen navigation={navigation} readOnly={!owner} />}
            {shown === 'partner' && <PartnerCycleScreen navigation={navigation} />}
            {shown === 'analysis' && <CycleAnalysisScreen navigation={navigation} />}
          </View>
        )}
      </CrossFade>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {left.map((t) => (
          <TabButton key={t.key} tab={t} active={active === t.key} onPress={() => setTab(t.key)} />
        ))}

        {owner && (
          <MorphButton
            onPress={() => navigation.navigate('CycleDailyLog', { date: todayDateString() })}
            style={styles.fab}
          >
            <Ionicons name="add" size={30} color="#fff" />
          </MorphButton>
        )}

        {right.map((t) => (
          <TabButton key={t.key} tab={t} active={active === t.key} onPress={() => setTab(t.key)} />
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
