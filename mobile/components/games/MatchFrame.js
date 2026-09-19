// The chrome every board sits in: whose turn it is, the result when it
// lands, the resign button, and the "start a match" empty state.
//
// Pulled out because all six boards need exactly the same states and it is
// the kind of thing that drifts if each screen writes its own.
import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../ThemeContext';
import { MorphButton, FadeInUp, Pop } from '../Motion';

function TurnPill({ match }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (match.status === 'finished') {
    const [label, icon, tint] = match.outcome === 'you'
      ? ['You won', 'trophy', colors.success]
      : match.outcome === 'them'
        ? ['They won', 'heart-dislike-outline', colors.danger]
        : ['A draw', 'remove-circle-outline', colors.textSecondary];
    return (
      <View style={[styles.pill, { backgroundColor: `${tint}22`, borderColor: tint }]}>
        <Ionicons name={icon} size={16} color={tint} />
        <Text style={[font.h3, { color: tint, marginLeft: 6 }]}>{label}</Text>
      </View>
    );
  }

  if (match.freeplay) {
    return (
      <View style={[styles.pill, styles.livePill]}>
        <Ionicons name="flash" size={16} color={colors.accentPink} />
        <Text style={[font.h3, { color: colors.accentPink, marginLeft: 6 }]}>Go whenever</Text>
      </View>
    );
  }

  return (
    <Pop active={match.yourTurn}>
      <View style={[styles.pill, match.yourTurn ? styles.yourTurn : styles.theirTurn]}>
        <Ionicons
          name={match.yourTurn ? 'play' : 'hourglass-outline'}
          size={16}
          color={match.yourTurn ? colors.accentPink : colors.textSecondary}
        />
        <Text style={[font.h3, { marginLeft: 6, color: match.yourTurn ? colors.accentPink : colors.textSecondary }]}>
          {match.yourTurn ? 'Your turn' : 'Their turn'}
        </Text>
      </View>
    </Pop>
  );
}

export default function MatchFrame({
  title, subtitle, match, loading, busy, error, rejection, clearRejection,
  onStart, onResign, children, footer,
}) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // The engine's own wording is the useful part ("you must take the capture
  // that is available"), so it is surfaced rather than swallowed.
  useEffect(() => {
    if (!rejection) return;
    Alert.alert('Not allowed', rejection, [{ text: 'OK', onPress: clearRejection }]);
  }, [rejection, clearRejection]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accentPink} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.textSecondary} />
        <Text style={[font.body, styles.centredText]}>{error}</Text>
      </View>
    );
  }

  if (!match) {
    return (
      <View style={styles.centered}>
        <Ionicons name="game-controller-outline" size={48} color={colors.accentPink} />
        <Text style={[font.h1, styles.centredText]}>{title}</Text>
        {subtitle ? <Text style={[font.muted, styles.centredText]}>{subtitle}</Text> : null}
        <MorphButton onPress={onStart} disabled={busy} style={styles.primary}>
          <Text style={styles.primaryText}>{busy ? 'Starting…' : 'Start a match'}</Text>
        </MorphButton>
        <Text style={[font.muted, styles.centredText, { marginTop: spacing.md }]}>
          Your partner joins the same match by opening this game on their phone.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <FadeInUp>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={font.h1}>{title}</Text>
            <Text style={font.muted}>Move {match.moveCount}</Text>
          </View>
          <TurnPill match={match} />
        </View>
      </FadeInUp>

      <FadeInUp delay={60}>{children}</FadeInUp>

      {footer ? <FadeInUp delay={90}>{footer}</FadeInUp> : null}

      <FadeInUp delay={120}>
        {match.status === 'finished' ? (
          <MorphButton onPress={onStart} disabled={busy} style={styles.primary}>
            <Text style={styles.primaryText}>{busy ? 'Starting…' : 'Play again'}</Text>
          </MorphButton>
        ) : (
          <MorphButton
            onPress={() => Alert.alert(
              'Resign?',
              'This counts as a loss.',
              [{ text: 'Keep playing', style: 'cancel' }, { text: 'Resign', style: 'destructive', onPress: onResign }]
            )}
            style={styles.resign}
          >
            <Text style={[font.muted, { color: colors.danger }]}>Resign</Text>
          </MorphButton>
        )}
      </FadeInUp>
    </ScrollView>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    content: { padding: spacing.lg, paddingBottom: 140 },
    centered: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      padding: spacing.xl, backgroundColor: 'transparent',
    },
    centredText: { textAlign: 'center', marginTop: spacing.sm },
    header: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', marginBottom: spacing.md,
    },
    pill: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: spacing.md, paddingVertical: 6,
      borderRadius: radius.pill, borderWidth: 1,
    },
    yourTurn: { backgroundColor: colors.accentSoft, borderColor: colors.accentPink },
    theirTurn: { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
    livePill: { backgroundColor: colors.accentSoft, borderColor: colors.accentPink },
    primary: {
      backgroundColor: colors.accentPink, borderRadius: radius.pill,
      paddingVertical: spacing.md, paddingHorizontal: spacing.xl,
      alignItems: 'center', marginTop: spacing.lg,
    },
    primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    resign: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.md },
  });
