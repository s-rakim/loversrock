// The badges, and the streak.
//
// Twenty-one of these were being awarded, stored and counted by the server
// with nowhere in the app to see them — which is the same as not having them.
//
// Nothing here is locked in the paywall sense. An unearned badge is shown,
// greyed, with what it takes: a row of mystery boxes is a worse thing to look
// at than a row of things you could go and do this afternoon.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import { MorphButton, FadeInUp } from '../components/Motion';
import CelebrationBurst from '../components/Celebration';

export default function AchievementsScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [badges, setBadges] = useState([]);
  const [earnedCount, setEarnedCount] = useState(0);
  const [streak, setStreak] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [celebrate, setCelebrate] = useState(0);
  const [repairing, setRepairing] = useState(false);

  const load = useCallback(async () => {
    try {
      // Reading this endpoint is what AWARDS anything newly satisfied — see
      // the note on the route for why that is a read with a side effect — so
      // opening the screen is also how you find out you earned something.
      const [list, streakState] = await Promise.all([
        apiFetch('/achievements'),
        apiFetch('/achievements/streak'),
      ]);
      setBadges(list.achievements || []);
      setEarnedCount(list.earnedCount || 0);
      setStreak(streakState);
      if ((list.newlyEarned || []).length > 0) {
        setCelebrate((n) => n + 1);
        const names = list.newlyEarned.map((b) => b.title).join(', ');
        Alert.alert(list.newlyEarned.length === 1 ? 'New badge' : 'New badges', names);
      }
    } catch (err) {
      Alert.alert('Could not load your badges', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function repair() {
    setRepairing(true);
    try {
      const res = await apiFetch('/achievements/streak/repair', { method: 'POST' });
      setCelebrate((n) => n + 1);
      Alert.alert('Streak repaired', `Back to ${res.streak} days.`);
      await load();
    } catch (err) {
      Alert.alert('Could not repair it', err.message);
    } finally {
      setRepairing(false);
    }
  }

  if (loading) return <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.celebration} pointerEvents="none">
        <CelebrationBurst trigger={celebrate} size={220} />
      </View>

      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.list}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.accent}
          />
        )}
      >
        {streak && (
          <FadeInUp>
            <View style={styles.streakCard}>
              <View style={styles.streakRow}>
                <View style={styles.streakBox}>
                  <Ionicons name="flame" size={22} color={colors.gold} />
                  <Text style={styles.bigNumber}>{streak.streak}</Text>
                  <Text style={font.muted}>day streak</Text>
                </View>
                <View style={styles.streakBox}>
                  <Ionicons name="trophy-outline" size={20} color={colors.textSecondary} />
                  <Text style={styles.bigNumber}>{streak.longest}</Text>
                  <Text style={font.muted}>best ever</Text>
                </View>
                <View style={styles.streakBox}>
                  <Ionicons name="ribbon-outline" size={20} color={colors.accent} />
                  <Text style={styles.bigNumber}>{earnedCount}</Text>
                  <Text style={font.muted}>of {badges.length}</Text>
                </View>
              </View>

              {/* A repair is once a month and only within a couple of days of
                  the break. A repair you can use whenever means the streak
                  counts nothing, and a number that counts nothing is not
                  worth showing. */}
              {streak.canRepair ? (
                <MorphButton onPress={repair} disabled={repairing} style={styles.repair}>
                  <Ionicons name="bandage-outline" size={16} color="#fff" />
                  <Text style={styles.repairText}>
                    {repairing ? 'Repairing…' : `Put back your ${streak.brokenStreak} day streak`}
                  </Text>
                </MorphButton>
              ) : streak.brokenStreak ? (
                <Text style={[font.muted, { marginTop: spacing.sm }]}>{streak.reason}</Text>
              ) : null}
            </View>
          </FadeInUp>
        )}

        <Text style={[font.h3, { marginTop: spacing.md }]}>Badges</Text>

        <View style={styles.grid}>
          {badges.map((badge, i) => (
            <FadeInUp key={badge.slug} delay={Math.min(i, 10) * 25} style={styles.cell}>
              <View style={[styles.badge, !badge.earned && styles.badgeLocked]}>
                <View style={[styles.badgeIcon, badge.earned && { backgroundColor: colors.accentSoft }]}>
                  <Ionicons
                    name={badge.icon}
                    size={20}
                    color={badge.earned ? colors.accent : colors.textMuted}
                  />
                </View>
                <Text style={[font.body, styles.badgeTitle, !badge.earned && { color: colors.textMuted }]}>
                  {badge.title}
                </Text>
                {/* The requirement, not a question mark. Something you could
                    go and do this afternoon beats a mystery box. */}
                <Text style={[font.muted, { fontSize: 11 }]} numberOfLines={2}>
                  {badge.blurb}
                </Text>
              </View>
            </FadeInUp>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    celebration: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
    list: { padding: spacing.md, paddingBottom: 120 },
    streakCard: {
      backgroundColor: colors.surface, borderRadius: radius.card,
      padding: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    streakRow: { flexDirection: 'row', gap: spacing.sm },
    streakBox: { flex: 1, alignItems: 'center', gap: 2 },
    bigNumber: { fontSize: 26, fontWeight: '800', color: colors.textPrimary },
    repair: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: spacing.xs, marginTop: spacing.md, paddingVertical: spacing.sm,
      borderRadius: radius.pill, backgroundColor: colors.accent,
    },
    repairText: { color: '#fff', fontWeight: '700' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    cell: { width: '48%' },
    badge: {
      backgroundColor: colors.surface, borderRadius: radius.card,
      padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: 4,
      minHeight: 128,
    },
    badgeLocked: { opacity: 0.55, borderStyle: 'dashed' },
    badgeIcon: {
      width: 38, height: 38, borderRadius: 19,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    badgeTitle: { fontWeight: '700' },
  });
