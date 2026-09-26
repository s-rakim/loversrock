// The cycle tracker shell.
//
// The reference app puts the whole tracker behind its own tab bar — Today ·
// Calendar · (+) · Partner · Analysis — and this keeps those sections, but not
// where the reference puts them.
//
// It used to sit at the BOTTOM, which is where the app's own floating bar
// already lives. The two drew on top of each other: "Today" landed on the
// Play button, "Calendar" on Quiz, and neither was reliably tappable. Photos
// and Play solved the same problem by putting their inner navigation at the
// top, and this now does the same, with the same component, so the three
// sections behave as one system instead of three.
//
// The add button could not come with it — a raised + in the middle of a top
// bar reads as nothing — so it floats in the corner above the main bar, where
// a thumb finds it, and only for the person who has something to log.
//
// Still deliberately not a nested navigator: a plain state switch through
// <CrossFade> gives the tab change a glide instead of a cut, and the log
// sheets are already a stack of their own one level up.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { spacing } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { CrossFade, MorphButton } from '../../components/Motion';
import { SectionBar } from '../../components/SectionBar';
import { useBarClearance } from '../../components/LumaBar';
import { useCycle, todayDateString } from '../../components/cycle/CycleContext';
import { FAB_SIZE } from '../../components/cycle/layout';

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
  const clearance = useBarClearance();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { loading, error, role } = useCycle();
  const tabs = role === 'partner' ? PARTNER_TABS : OWNER_TABS;
  const [tab, setTab] = useState(null);

  // The first tab of whichever set applies, rather than a hardcoded 'today':
  // the partner's set has no 'today', so hardcoding it rendered nothing.
  const active = tab && tabs.some((t) => t.key === tab) ? tab : tabs[0].key;

  // The bar below covers the notch, so what renders under it is told the top
  // is already handled — same arrangement as withSectionBar.
  const inner = useMemo(() => ({ ...insets, top: 0 }), [insets]);

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

  // The partner has no add button: there is nothing for them to log.
  const owner = role !== 'partner';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <SectionBar items={tabs} active={active} onSelect={setTab} />

      <SafeAreaInsetsContext.Provider value={inner}>
        <CrossFade activeKey={active}>
          {(shown) => (
            <View style={{ flex: 1 }}>
              {shown === 'today' && (
                <CycleTodayScreen navigation={navigation} onGoToTab={setTab} />
              )}
              {shown === 'calendar' && (
                <CycleCalendarScreen navigation={navigation} readOnly={!owner} />
              )}
              {shown === 'partner' && <PartnerCycleScreen navigation={navigation} />}
              {shown === 'analysis' && <CycleAnalysisScreen navigation={navigation} />}
            </View>
          )}
        </CrossFade>
      </SafeAreaInsetsContext.Provider>

      {owner && (
        <MorphButton
          onPress={() => navigation.navigate('CycleDailyLog', { date: todayDateString() })}
          accessibilityRole="button"
          accessibilityLabel="Log today"
          style={[styles.fab, { bottom: clearance.above }]}
        >
          <Ionicons name="add" size={30} color="#fff" />
        </MorphButton>
      )}
    </View>
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
    // Absolute, so it floats over the scrolling content rather than taking a
    // strip of the screen; `bottom` is set from the main bar's real height.
    fab: {
      position: 'absolute',
      right: spacing.lg,
      width: FAB_SIZE, height: FAB_SIZE, borderRadius: FAB_SIZE / 2,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.accentPink,
      shadowColor: colors.accentPink,
      shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
  });
