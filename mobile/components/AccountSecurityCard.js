// Settings → Sign-in: change your password, or sign out every other phone.
//
// Both end sessions on the server (backend models/sessions.js), not just on
// this phone: a password change ends every sign-in anywhere, including one
// somebody else might hold, and this phone carries on with fresh tokens.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { apiFetch, setTokens } from '../services/api';
import { spacing, radius } from '../theme';
import { useTheme } from './ThemeContext';
import { MorphButton } from './Motion';
import Icon from './Icon';

export const MIN_PASSWORD = 8;

export default function AccountSecurityCard({ style }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);

  const changePassword = async () => {
    if (next.length < MIN_PASSWORD) {
      setNote({ ok: false, text: `Use at least ${MIN_PASSWORD} characters.` });
      return;
    }
    setBusy('password');
    try {
      const tokens = await apiFetch('/auth/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      await setTokens(tokens);
      setCurrent('');
      setNext('');
      setNote({ ok: true, text: 'Password changed. Every other sign-in has been ended.' });
    } catch (err) {
      setNote({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const signOutOthers = () => Alert.alert(
    'Sign out everywhere else?',
    'Any other phone signed in to your account is signed out. This one stays signed in.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out others',
        style: 'destructive',
        onPress: async () => {
          setBusy('others');
          try {
            await setTokens(await apiFetch('/auth/logout-others', { method: 'POST' }));
            setNote({ ok: true, text: 'Every other sign-in has been ended.' });
          } catch (err) {
            setNote({ ok: false, text: err.message });
          } finally {
            setBusy(null);
          }
        },
      },
    ]
  );

  return (
    <View style={style}>
      <MorphButton onPress={() => setOpen((v) => !v)} style={styles.head}>
        <Icon name="key-outline" chip chipColor={colors.surfaceAlt} color={colors.textMuted} />
        <View style={{ flex: 1 }}>
          <Text style={font.body}>Password and sign-ins</Text>
          <Text style={font.muted}>Change your password, or sign out other phones.</Text>
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} chip={false} size={16} color={colors.textMuted} />
      </MorphButton>
      {open ? (
        <View style={styles.body}>
          <TextInput
            value={current}
            onChangeText={(t) => { setCurrent(t); setNote(null); }}
            placeholder="Current password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            style={styles.input}
          />
          <TextInput
            value={next}
            onChangeText={(t) => { setNext(t); setNote(null); }}
            placeholder={`New password (at least ${MIN_PASSWORD} characters)`}
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            style={styles.input}
          />
          <MorphButton
            onPress={changePassword}
            disabled={!current || !next || Boolean(busy)}
            style={[styles.primary, (!current || !next || busy) && styles.dim]}
          >
            {busy === 'password' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Change password</Text>}
          </MorphButton>
          <MorphButton onPress={signOutOthers} disabled={Boolean(busy)} style={styles.link}>
            {busy === 'others' ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.linkText}>Sign out everywhere else</Text>}
          </MorphButton>
          {note ? <Text style={[styles.note, { color: note.ok ? colors.success : colors.danger }]}>{note.text}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  body: { gap: spacing.sm, marginTop: spacing.md },
  input: {
    backgroundColor: colors.background, color: colors.text, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  primary: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: spacing.sm, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700' },
  link: { alignItems: 'center', paddingVertical: spacing.xs },
  linkText: { color: colors.accent, fontWeight: '600' },
  note: { fontSize: 13 },
  dim: { opacity: 0.5 },
});
