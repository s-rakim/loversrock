import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Switch, ScrollView } from 'react-native';
import Slider from '@react-native-community/slider';
import { useNavigation } from '@react-navigation/native';
import { apiFetch, clearTokens, disconnectSocket } from '../services/api';
import {
  clearWidgets,
  lockScreenStyle,
  refreshWidgets,
  setLockScreenEnabled,
  widgetsSupported,
} from '../services/widgetBridge';
import { useGlass } from '../components/GlassContext';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import ServerAddress from '../components/ServerAddress';
import { colors, font, spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';
import { useCouple } from '../components/CoupleContext';
import { LANGUAGES, useI18n } from '../i18n';
import { Chip } from '../components/ui';

// Every home/lock screen widget the native layer ships (see docs/WIDGETS.md).
const WIDGET_LIST = [
  ['image-outline', 'Partner photo / Daily Snap'],
  ['color-palette-outline', 'Shared Canvas'],
  ['finger-print-outline', 'Thumb Kiss / Quick Kiss'],
  ['flame-outline', 'Streak'],
  ['hourglass-outline', 'Countdown'],
  ['navigate-outline', 'Distance apart'],
  ['heart-outline', 'Days together'],
  ['calendar-outline', 'Anniversary'],
  ['happy-outline', 'Partner mood'],
  ['mail-unread-outline', 'Secret message'],
  ['document-text-outline', 'Love note'],
  ['chatbox-ellipses-outline', 'Daily question'],
  ['restaurant-outline', 'Next date'],
];

export default function SettingsScreen() {
  const { intensity, setIntensity } = useGlass();
  const navigation = useNavigation();
  const [lockScreenOn, setLockScreenOn] = useState(false);
  const { lang, setLang, t } = useI18n();
  const { partner, pair, refresh, clear: clearCouple } = useCouple();
  const [anniversary, setAnniversary] = useState('');
  const [togetherSince, setTogetherSince] = useState('');

  useEffect(() => {
    setAnniversary(pair?.anniversaryDate || '');
    setTogetherSince(pair?.togetherSince || '');
  }, [pair?.anniversaryDate, pair?.togetherSince]);

  async function saveRelationshipDates() {
    try {
      await apiFetch('/profile/pair', {
        method: 'PATCH',
        body: { anniversaryDate: anniversary || null, togetherSince: togetherSince || null },
      });
      await refresh();
      refreshWidgets();
      Alert.alert('Saved', 'Your widgets will pick this up on their next refresh.');
    } catch (err) {
      Alert.alert('Could not save', err.message);
    }
  }

  function toggleLockScreen(value) {
    setLockScreenOn(value);
    setLockScreenEnabled(value);
  }

  async function unlink() {
    Alert.alert('Unlink partner?', 'This clears your pairing. Your shared history is kept, never deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiFetch('/auth/unlink', { method: 'POST' });
            navigation.reset({ index: 0, routes: [{ name: 'Pairing' }] });
          } catch (err) {
            Alert.alert('Could not unlink', err.message);
          }
        },
      },
    ]);
  }

  async function logout() {
    clearCouple();
    await clearWidgets();
    await clearTokens();
    disconnectSocket();
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }

  return (
    <View style={styles.container}>
      <StickerField variant="minimal" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <FadeInUp>
        <View style={styles.headerRow}>
          <Icon name="settings-outline" chip chipSize={44} />
          <Text style={font.h1}>Settings</Text>
        </View>
      </FadeInUp>

      <FadeInUp delay={60}>
        <View style={styles.card}>
          <Text style={font.h2}>Bottom bar glass effect</Text>
          <Text style={[font.muted, { marginTop: spacing.xs, marginBottom: spacing.md }]}>
            Adjust how frosted vs. transparent the bottom navigation bar looks.
          </Text>
          <Slider
            minimumValue={0}
            maximumValue={100}
            step={5}
            value={intensity}
            onValueChange={setIntensity}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.accent}
          />
          <Text style={[font.muted, { textAlign: 'right' }]}>{Math.round(intensity)}%</Text>
        </View>
      </FadeInUp>

      <FadeInUp delay={70}>
        <View style={styles.card}>
          <Text style={font.h2}>Us</Text>
          <MorphButton onPress={() => navigation.navigate('Profile', { who: 'me' })} style={styles.linkRow}>
            <Icon name="person-circle-outline" chip chipColor={colors.surfaceAlt} />
            <Text style={[font.body, { flex: 1 }]}>{t('profile.mine')}</Text>
            <Icon name="chevron-forward" chip={false} size={16} color={colors.textMuted} />
          </MorphButton>
          {partner && (
            <MorphButton onPress={() => navigation.navigate('Profile', { who: 'partner' })} style={styles.linkRow}>
              <Icon name="heart-circle-outline" chip chipColor={colors.surfaceAlt} />
              <Text style={[font.body, { flex: 1 }]}>{partner.name}</Text>
              <Icon name="chevron-forward" chip={false} size={16} color={colors.textMuted} />
            </MorphButton>
          )}
          <MorphButton onPress={() => navigation.navigate('NotificationSettings')} style={styles.linkRow}>
            <Icon name="notifications-outline" chip chipColor={colors.surfaceAlt} />
            <Text style={[font.body, { flex: 1 }]}>{t('screen.notifications')}</Text>
            <Icon name="chevron-forward" chip={false} size={16} color={colors.textMuted} />
          </MorphButton>
          <MorphButton onPress={() => navigation.navigate('Onboarding')} style={styles.linkRow}>
            <Icon name="sparkles-outline" chip chipColor={colors.surfaceAlt} />
            <Text style={[font.body, { flex: 1 }]}>Redo onboarding</Text>
            <Icon name="chevron-forward" chip={false} size={16} color={colors.textMuted} />
          </MorphButton>
        </View>
      </FadeInUp>

      {pair && (
        <FadeInUp delay={75}>
          <View style={styles.card}>
            <Text style={font.h2}>Relationship dates</Text>
            <Text style={[font.muted, { marginTop: spacing.xs }]}>
              Powers the days-together counter and the anniversary widget. {pair.daysTogether} days so far.
            </Text>
            <Text style={styles.fieldLabel}>Anniversary</Text>
            <TextInput style={styles.field} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} value={anniversary} onChangeText={setAnniversary} />
            <Text style={styles.fieldLabel}>Together since</Text>
            <TextInput style={styles.field} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} value={togetherSince} onChangeText={setTogetherSince} />
            <MorphButton onPress={saveRelationshipDates} style={styles.refreshButton}>
              <Text style={{ color: colors.accent, fontWeight: '600' }}>{t('common.save')}</Text>
            </MorphButton>
          </View>
        </FadeInUp>
      )}

      <FadeInUp delay={80}>
        <View style={styles.card}>
          <Text style={font.h2}>Language</Text>
          <View style={styles.chips}>
            {LANGUAGES.map((l) => <Chip key={l.code} label={l.label} active={lang === l.code} onPress={() => setLang(l.code)} />)}
          </View>
        </View>
      </FadeInUp>

      <FadeInUp delay={90}>
        <View style={styles.card}>
          <Text style={font.h2}>Widgets</Text>
          {!widgetsSupported ? (
            <Text style={[font.muted, { marginTop: spacing.xs }]}>
              Home and lock screen widgets need a dev-client build — they can't run in Expo Go.
              See docs/WIDGETS.md.
            </Text>
          ) : (
            <>
              <Text style={[font.muted, { marginTop: spacing.xs, marginBottom: spacing.md }]}>
                Long-press your home screen to add the loversrock widgets.
              </Text>

              <View style={styles.settingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={font.body}>
                    {lockScreenStyle === 'widget' ? 'Lock screen widget' : 'Lock screen glance'}
                  </Text>
                  <Text style={font.muted}>
                    {lockScreenStyle === 'widget'
                      ? 'Add it from the lock screen customise menu.'
                      : 'Android has no lock screen widgets, so this shows as a quiet ongoing notification.'}
                  </Text>
                </View>
                {lockScreenStyle === 'notification' && (
                  <Switch
                    value={lockScreenOn}
                    onValueChange={toggleLockScreen}
                    trackColor={{ true: colors.accent }}
                  />
                )}
              </View>

              <View style={{ marginTop: spacing.md }}>
                {WIDGET_LIST.map(([icon, label]) => (
                  <View key={label} style={styles.widgetRow}>
                    <Icon name={icon} chip={false} size={16} color={colors.accent} />
                    <Text style={font.body}>{label}</Text>
                  </View>
                ))}
              </View>

              <MorphButton onPress={refreshWidgets} style={styles.refreshButton}>
                <Icon name="refresh-outline" chip={false} color={colors.accent} size={16} />
                <Text style={{ color: colors.accent, fontWeight: '600' }}>Refresh widgets now</Text>
              </MorphButton>
            </>
          )}
        </View>
      </FadeInUp>

      <FadeInUp delay={95}>
        <ServerAddress />
      </FadeInUp>

      <FadeInUp delay={100}>
        <MorphButton onPress={unlink} style={styles.actionRow}>
          <Icon name="person-remove-outline" chip chipColor={colors.surfaceAlt} color={colors.textMuted} />
          <Text style={font.body}>Unlink partner</Text>
        </MorphButton>
        <MorphButton onPress={logout} style={styles.actionRow}>
          <Icon name="log-out-outline" chip chipColor={colors.surfaceAlt} color={colors.danger} />
          <Text style={[font.body, { color: colors.danger }]}>Log out</Text>
        </MorphButton>
      </FadeInUp>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // Bottom padding clears the floating glass tab bar.
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xl * 3 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs, marginTop: spacing.xs },
  fieldLabel: { ...font.muted, marginTop: spacing.md, marginBottom: 4 },
  field: {
    backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  widgetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 3 },
  refreshButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.accentSoft, borderRadius: radius.pill, paddingVertical: spacing.sm, marginTop: spacing.md,
  },
});
