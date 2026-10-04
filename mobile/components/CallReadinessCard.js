// "Calls when the app is closed": what stops a call ringing a phone whose app
// is not open, checked, with a button to fix each.
//
// A call rings a closed app through a push, and a phone decides whether that
// push may wake the app. Instagram and WhatsApp ring because the phone makers
// put them on an allow list; loversrock is not on it, so on OPPO (ColorOS),
// Xiaomi, Vivo, Huawei and some Samsungs the app has to be allowed by hand,
// once. Android 14 also asks before an app may show a call full screen.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, NativeModules, Platform, AppState } from 'react-native';
import { spacing, radius } from '../theme';
import { useTheme } from './ThemeContext';
import { MorphButton } from './Motion';
import Icon from './Icon';

const Native = Platform.OS === 'android' ? NativeModules.VoiceNotes : null;

/** What to check, and what each one says when it is off. */
export const CHECKS = [
  { key: 'notifications', label: 'Notifications', off: 'Off: nothing can ring or show.', fix: 'notifications' },
  { key: 'ringChannel', label: 'Incoming call ringing', off: 'The "Incoming calls (ringing)" channel is off.', fix: 'notifications' },
  { key: 'battery', label: 'Run in the background', off: 'Battery saving can stop the app hearing a call.', fix: 'battery' },
  { key: 'fullScreen', label: 'Show calls full screen', off: 'Calls only show as a notification on the lock screen.', fix: 'fullscreen' },
];

export default function CallReadinessCard() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [state, setState] = useState(null);

  const check = useCallback(() => {
    if (!Native?.callReadiness) return;
    Native.callReadiness().then((json) => setState(JSON.parse(json))).catch(() => setState(null));
  }, []);
  useEffect(() => {
    check();
    // Back from the settings page: look again.
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => sub.remove();
  }, [check]);

  // Only phones with this build's native side can answer, and only Android
  // has any of this to fix.
  if (!Native?.callReadiness || !state) return null;
  const open = (which) => Native.openCallSetting(which).catch(() => {});
  const allOn = CHECKS.every((c) => state[c.key] !== false);
  const maker = String(state.manufacturer || '').toLowerCase();
  const makerName = /oppo|realme|oneplus/.test(maker) ? 'OPPO' : /xiaomi|redmi|poco/.test(maker) ? 'Xiaomi'
    : /vivo/.test(maker) ? 'Vivo' : /huawei|honor/.test(maker) ? 'Huawei' : /samsung/.test(maker) ? 'Samsung' : null;

  return (
    <View style={styles.card}>
      <Text style={font.h2}>Calls when the app is closed</Text>
      <Text style={[font.muted, { marginTop: spacing.xs }]}>
        {allOn
          ? 'Everything the app can check is on.'
          : 'A call can only ring this phone with the app closed if these are on.'}
      </Text>
      {CHECKS.map((c) => {
        const on = state[c.key] !== false;
        return (
          <View key={c.key} style={styles.row}>
            <Icon name={on ? 'checkmark-circle' : 'alert-circle'} chip={false} size={18} color={on ? colors.success : colors.danger} />
            <View style={{ flex: 1 }}>
              <Text style={font.body}>{c.label}</Text>
              {!on ? <Text style={font.muted}>{c.off}</Text> : null}
            </View>
            {!on ? (
              <MorphButton onPress={() => open(c.fix)} style={styles.fix}>
                <Text style={styles.fixText}>Fix</Text>
              </MorphButton>
            ) : null}
          </View>
        );
      })}
      {/* The one the app cannot see: the phone maker's own auto-launch list. */}
      <View style={styles.row}>
        <Icon name="rocket-outline" chip={false} size={18} color={colors.gold || colors.accent} />
        <View style={{ flex: 1 }}>
          <Text style={font.body}>Auto launch{makerName ? ` (${makerName})` : ''}</Text>
          <Text style={font.muted}>
            {makerName === 'OPPO'
              ? 'Turn on Auto launch for loversrock, and set Battery to "Allow background activity". Then calls ring even after you swipe the app away.'
              : 'If your phone has an auto-launch or "background activity" list, allow loversrock there. The app cannot check this one.'}
          </Text>
        </View>
        <MorphButton onPress={() => open('autostart')} style={styles.fix}>
          <Text style={styles.fixText}>Open</Text>
        </MorphButton>
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.card || radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  fix: {
    backgroundColor: colors.accentSoft || colors.background, borderRadius: radius.pill,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
  },
  fixText: { color: colors.accent, fontWeight: '700' },
});
