// Badges for milestones you reach together, with progress bars for the rest.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { Card, Screen } from '../components/ui';
import { FadeInUp } from '../components/Motion';
import Icon from '../components/Icon';
import CelebrationBurst from '../components/Celebration';
import { useI18n } from '../i18n';
import { colors, font, spacing, radius } from '../theme';

export default function AchievementsScreen() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  useFocusEffect(useCallback(() => {
    apiFetch('/achievements').then(setData).catch((err) => Alert.alert(t('common.error'), err.message));
  }, []));

  if (!data) return <Screen><Text style={font.muted}>{t('common.loading')}</Text></Screen>;

  return (
    <Screen sticker="celebrate">
      <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
        <Icon name="trophy" size={30} chip chipSize={60} color={colors.gold} chipColor="#FFF4DA" />
        <Text style={[font.h1, { marginTop: spacing.sm }]}>{t('achievements.count', { n: data.unlockedCount, total: data.total })}</Text>
        <CelebrationBurst trigger={data.newlyUnlocked.length} />
      </View>
      {data.achievements.map((a, i) => (
        <FadeInUp key={a.key} delay={i * 25}>
          <Card style={[styles.row, !a.unlocked && { opacity: 0.75 }]}>
            <Icon name={a.unlocked ? a.icon : `${a.icon}-outline`} size={22} chip chipSize={48} color={a.unlocked ? colors.gold : colors.textMuted} chipColor={a.unlocked ? '#FFF4DA' : colors.surfaceAlt} />
            <View style={{ flex: 1 }}>
              <Text style={font.h2}>{a.title}</Text>
              <Text style={font.muted}>{a.description}</Text>
              {!a.unlocked && (
                <View style={styles.track}><View style={[styles.fill, { width: `${Math.round((a.progress / a.goal) * 100)}%` }]} /></View>
              )}
            </View>
            <Text style={styles.reward}>{a.unlocked ? '✓' : `+${a.sparks}`}</Text>
          </Card>
        </FadeInUp>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  track: { height: 6, backgroundColor: colors.border, borderRadius: 3, marginTop: spacing.xs, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.accent, borderRadius: 3 },
  reward: { fontWeight: '800', color: colors.gold, minWidth: 36, textAlign: 'right', borderRadius: radius.sm },
});
