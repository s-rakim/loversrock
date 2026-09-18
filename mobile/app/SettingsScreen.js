import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, Switch } from 'react-native';
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
import { colors, font, spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';

export default function SettingsScreen() {
  const { intensity, setIntensity } = useGlass();
  const navigation = useNavigation();
  const [lockScreenOn, setLockScreenOn] = useState(false);

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
    await clearWidgets();
    await clearTokens();
    disconnectSocket();
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }

  return (
    <View style={styles.container}>
      <StickerField variant="minimal" />
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

              <MorphButton onPress={refreshWidgets} style={styles.refreshButton}>
                <Icon name="refresh-outline" chip={false} color={colors.accent} size={16} />
                <Text style={{ color: colors.accent, fontWeight: '600' }}>Refresh widgets now</Text>
              </MorphButton>
            </>
          )}
        </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
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
  refreshButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.accentSoft, borderRadius: radius.pill, paddingVertical: spacing.sm, marginTop: spacing.md,
  },
});
