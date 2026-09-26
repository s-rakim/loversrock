// Do notifications actually work, and if not, which half is missing?
//
// Push has two halves that fail the same way. The phone needs a push address
// from Firebase, which only exists if the APK was built with
// google-services.json in it. The server needs a Firebase key
// (FIREBASE_SERVICE_ACCOUNT_JSON) to send to that address. Missing either,
// nothing arrives and nothing says why. This card registers the phone and
// asks the server to send one test notification, then says which half broke.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { apiFetch } from '../services/api';
import { registerForPush } from '../services/notifications';
import { spacing, radius } from '../theme';
import { useTheme } from './ThemeContext';
import { MorphButton } from './Motion';
import Icon from './Icon';

/** What the phone's half said, in words. */
function phoneProblem(reason = '') {
  if (reason === 'permission-denied') {
    return 'Notifications are turned off for loversrock. Turn them on in your phone\'s settings, then check again.';
  }
  if (reason.startsWith('token-')) {
    return 'This APK was built without Firebase (google-services.json), so the phone has no push address. '
      + 'It needs a new build: see docs/NOTIFICATIONS.md.';
  }
  if (reason.startsWith('server:')) return `The phone could not register with the server. ${reason.slice(7).trim()}`;
  return `The phone could not register for push: ${reason}`;
}

/** What the server's half said, in words. */
function serverVerdict(r) {
  if (!r.serverConfigured) {
    return { ok: false, text: `The server cannot send notifications. ${r.serverReason} See docs/NOTIFICATIONS.md.` };
  }
  if (r.devices === 0) return { ok: false, text: 'The server has no push address for this phone yet.' };
  if (r.sent > 0) {
    return {
      ok: true,
      text: 'Sent. It should arrive in a few seconds. If it does not, allow loversrock to run in the '
        + 'background in your phone\'s battery settings.',
    };
  }
  if (r.error === 'messaging/mismatched-credential' || r.error === 'messaging/sender-id-mismatch') {
    return {
      ok: false,
      text: 'The server\'s Firebase key and the app\'s google-services.json come from two different '
        + 'Firebase projects. Both must come from the same one.',
    };
  }
  return { ok: false, text: `Firebase refused the test: ${r.error || 'unknown error'}` };
}

export default function PushCheckCard() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const check = async () => {
    setBusy(true);
    setResult(null);
    try {
      const phone = await registerForPush();
      if (!phone.registered) {
        setResult({ ok: false, text: phoneProblem(phone.reason) });
        return;
      }
      setResult(serverVerdict(await apiFetch('/auth/push-test', { method: 'POST' })));
    } catch (err) {
      setResult({
        ok: false,
        text: err.status === 404
          ? 'Your server is older than the app. Update the backend, then check again.'
          : err.message,
      });
    } finally {
      setBusy(false);
    }
  };

  const tone = result ? (result.ok ? colors.success : colors.danger) : colors.textMuted;

  return (
    <View style={styles.card}>
      <Text style={font.h2}>Notifications</Text>
      <Text style={[font.muted, { marginTop: spacing.xs }]}>
        Sends you a test notification, and says what is wrong if it cannot.
      </Text>

      {result && (
        <View style={styles.row}>
          <Icon
            name={result.ok ? 'checkmark-circle' : 'alert-circle'}
            chip chipSize={38} color={tone} chipColor={colors.surfaceAlt}
          />
          <Text style={[font.body, { flex: 1 }]}>{result.text}</Text>
        </View>
      )}

      <MorphButton onPress={check} disabled={busy} style={styles.button}>
        {busy
          ? <ActivityIndicator color={colors.accent} />
          : <Icon name="notifications-outline" chip={false} size={16} color={colors.accent} />}
        <Text style={{ color: colors.accent, fontWeight: '600' }}>Send a test notification</Text>
      </MorphButton>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
      borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
    button: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
      backgroundColor: colors.accentSoft, borderRadius: radius.pill,
      paddingVertical: spacing.sm, marginTop: spacing.md,
    },
  });
