import React, { useCallback, useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import Icon from './Icon';
import { spacing, radius } from '../theme';
import { MorphButton } from './Motion';
import { useTheme } from './ThemeContext';

const MAX_LENGTH = 30; // matches the backend's validator

/**
 * The two nicknames in a pairing, which are independent: the one you chose for
 * them is yours to edit, the one they chose for you is theirs and shown
 * read-only. Clearing yours falls back to their real name.
 */
export default function NicknameCard() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/profile');
      setProfile(data);
      setDraft(data.partner?.nickname || '');
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function save() {
    const nickname = draft.trim();
    if (!nickname) return clear();

    setBusy(true);
    try {
      await apiFetch('/profile/nickname', { method: 'PUT', body: { nickname } });
      await load();
    } catch (err) {
      Alert.alert('Could not save', err.message);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await apiFetch('/profile/nickname', { method: 'DELETE' });
      setDraft('');
      await load();
    } catch (err) {
      Alert.alert('Could not clear', err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Icon name="heart-circle-outline" size={18} />
          <Text style={font.h2}>Nicknames</Text>
        </View>
        <Text style={[font.muted, styles.hint]}>{error}</Text>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!profile.paired) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Icon name="heart-circle-outline" size={18} />
          <Text style={font.h2}>Nicknames</Text>
        </View>
        <Text style={[font.muted, styles.hint]}>
          Pair up first — a nickname belongs to the two of you.
        </Text>
      </View>
    );
  }

  const theirName = profile.partner.name;
  const theyCallYou = profile.me.nickname;
  const unchanged = draft.trim() === (profile.partner.nickname || '');

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Icon name="heart-circle-outline" size={18} />
        <Text style={font.h2}>Nicknames</Text>
      </View>

      <Text style={[font.muted, styles.hint]}>What you call {theirName}</Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        maxLength={MAX_LENGTH}
        autoCapitalize="words"
        autoCorrect={false}
        placeholder={theirName}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
      />
      <Text style={[font.muted, styles.counter]}>{draft.length}/{MAX_LENGTH}</Text>

      <View style={styles.buttonRow}>
        <View style={styles.buttonSlot}>
          <MorphButton onPress={save} disabled={busy || unchanged} style={[styles.button, unchanged ? styles.disabled : styles.primary]}>
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryText}>Save</Text>}
          </MorphButton>
        </View>
        {Boolean(profile.partner.nickname) && (
          <View style={styles.buttonSlot}>
            <MorphButton onPress={clear} disabled={busy} style={[styles.button, styles.secondary]}>
              <Text style={styles.secondaryText}>Clear</Text>
            </MorphButton>
          </View>
        )}
      </View>

      <View style={styles.divider} />

      <Text style={[font.muted, styles.hint]}>What {theirName} calls you</Text>
      {theyCallYou ? (
        <Text style={styles.theirChoice}>{theyCallYou}</Text>
      ) : (
        <Text style={[font.muted, styles.awaiting]}>
          Nothing yet — only {theirName} can set this one.
        </Text>
      )}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  hint: { fontSize: 12, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.bg, color: colors.text, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  counter: { fontSize: 11, textAlign: 'right', marginTop: 2 },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  buttonSlot: { flex: 1 },
  button: { borderRadius: radius.pill, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.accent },
  disabled: { backgroundColor: colors.border },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondary: { backgroundColor: colors.accentSoft },
  secondaryText: { color: colors.accent, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
  theirChoice: { fontSize: 20, color: colors.accent, fontWeight: '700' },
  awaiting: { fontSize: 13 },
});
