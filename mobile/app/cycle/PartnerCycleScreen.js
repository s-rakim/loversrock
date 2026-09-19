// The partner's read-only view of the other person's cycle.
//
// This is the screen from the reference app's partner mode: their name at the
// top, the phase headline with the next-period date, a phase card with the
// cycle bar, the Sex drive and Moment cards with how long ago each was
// updated, the pregnancy-chance curve, and today's symptoms.
//
// Everything here is assembled server-side from the categories the owner
// switched on (docs/SPEC.md #5, amended). Nothing is requested that the
// owner has not shared, and there is no write path — a partner can look,
// never log.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Svg, { Path, Line, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { Stagger } from '../../components/Motion';
import PhaseBar from '../../components/cycle/PhaseBar';
import { useCycle } from '../../components/cycle/CycleContext';
import { apiFetch } from '../../services/api';
import { PHASE_META, SYMPTOMS_BY_ID, MOODS_BY_ID, SEX_DRIVE_LEVELS } from '../../data/cycleCatalog';

function prettyDate(date) {
  if (!date) return null;
  return new Date(`${String(date).slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

/** "Update 9 days ago", the way the reference labels a stale card. */
function agoLabel(timestamp) {
  if (!timestamp) return 'Not updated yet';
  const days = Math.floor((Date.now() - new Date(timestamp).getTime()) / 86400000);
  if (days <= 0) return 'Updated today';
  if (days === 1) return 'Update 1 day ago';
  return `Update ${days} days ago`;
}

/**
 * The pregnancy-chance curve: a bell centred on ovulation, with a vertical
 * line on today. Drawn as a cubic path rather than a real distribution —
 * it is an at-a-glance shape, and the app makes no clinical claim about it.
 */
function ChanceCurve({ cycleDay, cycleLength, ovulationDay, color }) {
  const width = 260;
  const height = 92;
  const peak = ((ovulationDay || cycleLength - 14) / cycleLength) * width;
  const spread = width * 0.16;

  const path =
    `M 0 ${height} ` +
    `C ${peak - spread * 2} ${height} ${peak - spread} 4 ${peak} 4 ` +
    `C ${peak + spread} 4 ${peak + spread * 2} ${height} ${width} ${height} Z`;
  const todayX = Math.min(width, Math.max(0, ((cycleDay || 1) / cycleLength) * width));

  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <SvgGradient id="chance" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0.85" />
          <Stop offset="1" stopColor={color} stopOpacity="0.15" />
        </SvgGradient>
      </Defs>
      <Path d={path} fill="url(#chance)" />
      <Line x1={todayX} y1="0" x2={todayX} y2={height} stroke="#FFFFFF" strokeWidth="2" />
    </Svg>
  );
}

export default function PartnerCycleScreen() {
  const { colors, font, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { partner, settings } = useCycle();
  const [partnerName, setPartnerName] = useState(null);

  useEffect(() => {
    apiFetch('/profile')
      .then((data) => setPartnerName(data?.partner?.displayName || null))
      .catch(() => setPartnerName(null));
  }, []);

  const name = partnerName || 'Your partner';

  if (!partner) {
    return (
      <View style={styles.centered}>
        <Ionicons name="heart-outline" size={40} color={colors.textSecondary} />
        <Text style={[font.h2, { marginTop: spacing.sm, textAlign: 'center' }]}>No partner yet</Text>
        <Text style={[font.muted, { marginTop: spacing.xs, textAlign: 'center' }]}>
          Pair up and their cycle appears here — if they choose to share it.
        </Text>
      </View>
    );
  }

  if (!partner.sharingEnabled) {
    return (
      <View style={styles.centered}>
        <Ionicons name="lock-closed-outline" size={40} color={colors.textSecondary} />
        <Text style={[font.h2, { marginTop: spacing.sm, textAlign: 'center' }]}>
          {name} isn't sharing their cycle
        </Text>
        <Text style={[font.muted, { marginTop: spacing.xs, textAlign: 'center' }]}>
          It's theirs to share. They can turn it on from their own tracker at any time.
        </Text>
      </View>
    );
  }

  const predictions = partner.predictions;
  const phase = predictions?.phase ? PHASE_META[predictions.phase] : null;
  const today = partner.today || {};
  const cycleLength = settings?.averageCycleLength || 28;
  const ovulationDay = predictions?.ovulationDate && predictions?.cycleDay
    ? cycleLength - 14
    : cycleLength - 14;
  const sexDrive = SEX_DRIVE_LEVELS.find((l) => l.id === today.sexDrive);
  // `moment` is the one they picked to lead with; fall back to the first mood
  // so the card is never blank when moods are shared but moment was not set.
  const headlineMood = today.moment || today.moods?.[0] || null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stagger delayStep={60}>
        <View style={styles.hero}>
          <Text style={[font.muted, { textAlign: 'center' }]}>{name}'s cycle</Text>
          <Text style={[font.wordmark, styles.phaseTitle]}>
            {phase ? (predictions.phase === 'ovulation' ? 'Ovulation Day' : `${phase.label} Phase`) : 'No prediction yet'}
          </Text>
          {predictions?.nextPeriodDate && (
            <Text style={[font.h3, { textAlign: 'center', color: colors.textSecondary }]}>
              {prettyDate(predictions.nextPeriodDate)} – Next Period
            </Text>
          )}
        </View>

        {phase && (
          <View style={styles.card}>
            <Text style={[font.h3, { color: colors.accentIndigo }]}>Cycle phase</Text>
            <Text style={[font.body, { marginTop: spacing.xs }]}>
              {name} {phase.blurb}
            </Text>
            <PhaseBar
              cycleDay={predictions.cycleDay}
              cycleLength={cycleLength}
              periodLength={settings?.averagePeriodLength}
              ovulationDay={ovulationDay}
            />
          </View>
        )}

        <View style={styles.twoUp}>
          <View style={[styles.card, styles.half]}>
            <View style={styles.cardHead}>
              <Text style={[font.h3, { color: colors.accentIndigo }]}>Sex drive</Text>
              <Ionicons name="hand-left-outline" size={16} color={colors.accentIndigo} />
            </View>
            <Text style={[font.muted, { fontSize: 11 }]}>{agoLabel(today.updatedAt)}</Text>
            {'sexDrive' in today || 'sexDriveLogged' in today ? (
              <View style={styles.centreBlock}>
                <Ionicons
                  name={sexDrive?.icon || 'heart-half-outline'}
                  size={30}
                  color={colors.accentPink}
                />
                <Text style={[font.h3, { marginTop: spacing.xs }]}>
                  {sexDrive?.label || (today.sexDriveLogged ? 'Active' : 'Not set')}
                </Text>
              </View>
            ) : (
              <Text style={[font.muted, styles.notShared]}>Not shared</Text>
            )}
          </View>

          <View style={[styles.card, styles.half]}>
            <View style={styles.cardHead}>
              <Text style={[font.h3, { color: colors.accentIndigo }]}>Moment</Text>
              <Ionicons name="hand-left-outline" size={16} color={colors.accentIndigo} />
            </View>
            <Text style={[font.muted, { fontSize: 11 }]}>{agoLabel(today.updatedAt)}</Text>
            {headlineMood ? (
              <View style={styles.centreBlock}>
                <Ionicons
                  name={MOODS_BY_ID[headlineMood]?.icon || 'happy-outline'}
                  size={30}
                  color={colors.accentPink}
                />
                <Text style={[font.h3, { marginTop: spacing.xs }]}>
                  {MOODS_BY_ID[headlineMood]?.label || headlineMood}
                </Text>
                {/* The card only has room for one, so say when there are more
                    rather than silently dropping them — the full set is in
                    Today's mood below. */}
                {today.moods?.length > 1 && (
                  <Text style={[font.muted, { fontSize: 11, marginTop: 2 }]}>
                    +{today.moods.length - 1} more
                  </Text>
                )}
              </View>
            ) : (
              <Text style={[font.muted, styles.notShared]}>
                {partner.shared?.share_mood ? 'Nothing logged today.' : 'Not shared'}
              </Text>
            )}
          </View>
        </View>

        {predictions && (
          <View style={styles.card}>
            <Text style={[font.h3, { color: colors.accentIndigo }]}>Pregnancy chance</Text>
            <ChanceCurve
              cycleDay={predictions.cycleDay}
              cycleLength={cycleLength}
              ovulationDay={ovulationDay}
              color={isDark ? '#A99BF5' : '#8F6AFF'}
            />
            <Text style={[font.muted, { textAlign: 'center' }]}>
              Highest around ovulation · day {ovulationDay}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={[font.h3, { color: colors.accentIndigo }]}>Today's mood</Text>
          {today.moods?.length ? (
            <View style={styles.chipWrap}>
              {today.moods.map((id) => (
                <View key={id} style={styles.chip}>
                  <Ionicons
                    name={MOODS_BY_ID[id]?.icon || 'happy-outline'}
                    size={14}
                    color={colors.accentIndigo}
                  />
                  <Text style={[font.muted, { marginLeft: 4 }]}>
                    {MOODS_BY_ID[id]?.label || id}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[font.muted, { marginTop: spacing.xs }]}>
              {partner.shared?.share_mood ? 'Nothing logged today.' : 'Not shared.'}
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={[font.h3, { color: colors.accentIndigo }]}>Today's symptoms</Text>
          {today.symptoms?.length ? (
            <View style={styles.chipWrap}>
              {today.symptoms.map((id) => (
                <View key={id} style={styles.chip}>
                  <Ionicons
                    name={SYMPTOMS_BY_ID[id]?.icon || 'ellipse-outline'}
                    size={14}
                    color={colors.accentPink}
                  />
                  <Text style={[font.muted, { marginLeft: 4 }]}>
                    {SYMPTOMS_BY_ID[id]?.label || id}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[font.muted, { marginTop: spacing.xs }]}>
              {partner.shared?.share_symptoms ? 'Nothing logged today.' : 'Not shared.'}
            </Text>
          )}

          {today.flow && (
            <Text style={[font.body, { marginTop: spacing.sm }]}>Flow: {today.flow}</Text>
          )}
          {today.notes && (
            <Text style={[font.body, { marginTop: spacing.sm }]}>"{today.notes}"</Text>
          )}
        </View>
      </Stagger>
    </ScrollView>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    content: { padding: spacing.lg, paddingBottom: spacing.xl },
    centered: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      padding: spacing.xl, backgroundColor: 'transparent',
    },
    hero: { alignItems: 'center', paddingVertical: spacing.xl },
    phaseTitle: { textAlign: 'center', marginVertical: spacing.sm },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md,
      marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    twoUp: { flexDirection: 'row', gap: spacing.sm },
    half: { flex: 1 },
    centreBlock: { alignItems: 'center', marginTop: spacing.md },
    notShared: { marginTop: spacing.lg, textAlign: 'center' },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
    chip: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.categoryChip, borderRadius: radius.pill,
      paddingHorizontal: spacing.sm, paddingVertical: 4,
    },
  });
