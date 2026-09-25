// Per-category push switches (mood changes, feed activity, secrets, …).
import React, { useCallback, useState } from 'react';
import { View, Text, Switch, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { registerForPush } from '../services/push';
import { Button, Card, Screen } from '../components/ui';
import { useI18n } from '../i18n';
import { colors, font, spacing } from '../theme';

export default function NotificationSettingsScreen() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState(null);
  useFocusEffect(useCallback(() => {
    apiFetch('/profile/notifications').then((d) => setPrefs(d.prefs)).catch((err) => Alert.alert(t('common.error'), err.message));
  }, []));

  async function toggle(key, value) {
    setPrefs((p) => ({ ...p, [key]: value }));
    try {
      const d = await apiFetch('/profile/notifications', { method: 'PATCH', body: { [key]: value } });
      setPrefs(d.prefs);
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }

  return (
    <Screen>
      <Button icon="notifications" title={t('notifications.enable')} onPress={async () => {
        const r = await registerForPush();
        Alert.alert(r.granted ? t('notifications.onTitle') : t('notifications.offTitle'), r.granted ? t('notifications.onBody') : r.reason || t('notifications.offBody'));
      }} style={{ marginBottom: spacing.md }} />
      <Card>
        {prefs && Object.entries(prefs).map(([key, on]) => (
          <View key={key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={font.body}>{t(`notifications.${key}`)}</Text>
              <Text style={font.muted}>{t(`notifications.${key}.hint`)}</Text>
            </View>
            <Switch value={on} onValueChange={(v) => toggle(key, v)} trackColor={{ true: colors.accent }} />
          </View>
        ))}
      </Card>
    </Screen>
  );
}
