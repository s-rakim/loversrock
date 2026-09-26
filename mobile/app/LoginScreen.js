import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import Constants from 'expo-constants';
import { apiFetch, apiUrlProblem, getApiUrl, setTokens } from '../services/api';
import { provisionWidgets } from '../services/widgetBridge';
import { spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';
import StickerField, { HeartShape } from '../components/Stickers';
import ServerAddress from '../components/ServerAddress';
import { useTheme } from '../components/ThemeContext';
import { Ionicons } from '@expo/vector-icons';

/**
 * The two sides of the cycle tracker.
 *
 * Deliberately worded around what the person DOES rather than around gender:
 * "I track my cycle" and "I'm the partner" are true for whoever they apply
 * to, and the app has no business inferring either from anything else.
 */
const ROLES = [
  {
    key: 'owner',
    icon: 'flower',
    title: 'I track my cycle',
    blurb: 'Full calendar, logging and history. You choose what is shared.',
  },
  {
    key: 'partner',
    icon: 'heart',
    title: "I'm the partner",
    blurb: 'You see what they choose to share, and nothing else.',
  },
];

export default function LoginScreen({ navigation }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  // Which side of the cycle tracker this account is on. Asked here because
  // nothing else in an account says which somebody is, and getting it wrong
  // is not cosmetic: it either hands the person tracking a screen they cannot
  // write to, or points someone else's health data at the wrong account.
  const [cycleRole, setCycleRole] = useState('owner');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  // If the build shipped the eas.json placeholder (or points at localhost),
  // nothing can work until the address is corrected — so open that card
  // straight away rather than hiding the only useful control behind a tap.
  const [showServer, setShowServer] = useState(Boolean(apiUrlProblem()));

  async function submit() {
    if (!email || !password || (mode === 'signup' && !name)) {
      Alert.alert('Missing info', 'Please fill in every field.');
      return;
    }
    setLoading(true);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/signup';
      const body = mode === 'login'
        ? { email, password }
        : { name, email, password, cycleRole };
      const data = await apiFetch(path, { method: 'POST', body });
      await setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });

      // Hands the home/lock screen widgets their own scoped token. No-ops in
      // Expo Go, where the native widget module isn't present.
      provisionWidgets();

      try {
        await apiFetch('/bucket-list');
        navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
      } catch {
        navigation.reset({ index: 0, routes: [{ name: 'Pairing' }] });
      }
    } catch (err) {
      Alert.alert('Something went wrong', err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StickerField variant="form" />
      <FadeInUp>
        <View style={styles.wordmarkRow}>
          <HeartShape size={26} />
          <Text style={font.wordmark}>loversrock.</Text>
        </View>
        <Text style={[font.muted, { marginTop: spacing.xs, marginBottom: spacing.xl }]}>
          just for the two of you.
        </Text>
      </FadeInUp>

      <FadeInUp delay={100}>
        {mode === 'signup' && (
          <TextInput
            placeholder="Name"
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={setName}
            style={styles.input}
          />
        )}

        {/* Two accounts, two jobs. The cycle tracker is the one part of this
            app that is not symmetric: one of you keeps a health diary, the
            other is shown the parts of it that were chosen for them. Asking
            once here is what lets every cycle screen know, afterwards,
            whether it is showing somebody their own record or somebody
            else's. It can be changed later in Settings. */}
        {mode === 'signup' && (
          <View style={styles.roles}>
            <Text style={[font.muted, styles.rolesLabel]}>Which one are you?</Text>
            {ROLES.map((role) => {
              const picked = cycleRole === role.key;
              return (
                <MorphButton
                  key={role.key}
                  onPress={() => setCycleRole(role.key)}
                  style={[styles.role, picked && styles.rolePicked]}
                >
                  <Ionicons
                    name={picked ? role.icon : `${role.icon}-outline`}
                    size={20}
                    color={picked ? colors.accent : colors.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[font.body, picked && { color: colors.accent, fontWeight: '800' }]}>
                      {role.title}
                    </Text>
                    <Text style={[font.muted, { fontSize: 12 }]}>{role.blurb}</Text>
                  </View>
                  {picked ? <Ionicons name="checkmark-circle" size={20} color={colors.accent} /> : null}
                </MorphButton>
              );
            })}
          </View>
        )}
        <TextInput
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />
        <TextInput
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={styles.input}
        />

        <MorphButton onPress={submit} disabled={loading} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}</Text>
        </MorphButton>

        <MorphButton onPress={() => setMode(mode === 'login' ? 'signup' : 'login')} style={styles.switchButton}>
          <Text style={font.muted}>
            {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
          </Text>
        </MorphButton>

        <MorphButton onPress={() => setShowServer((v) => !v)} style={styles.switchButton}>
          <Text style={[font.muted, styles.diagnostic]}>
            {showServer ? 'Hide server settings' : 'Can\u2019t connect? Check the server address'}
          </Text>
        </MorphButton>

        {showServer && <ServerAddress compact />}

        {/* Always visible, deliberately. Without it there is no way to tell
            from a screenshot which build is installed or where it is pointed,
            and "it still fails" is ambiguous between a stale APK and a real
            fault. */}
        <Text style={styles.buildStamp}>
          v{Constants.expoConfig?.version || '?'} · {Constants.expoConfig?.extra?.commit || 'local'} ·{' '}
          {getApiUrl().replace(/^https?:\/\//, '')}
        </Text>
      </FadeInUp>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', justifyContent: 'center', padding: spacing.lg },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  roles: { marginBottom: spacing.md, gap: spacing.sm },
  rolesLabel: { marginBottom: spacing.xs },
  role: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  rolePicked: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  switchButton: { alignItems: 'center', marginTop: spacing.md },
  diagnostic: { fontSize: 12, textAlign: 'center' },
  buildStamp: { fontSize: 10, textAlign: 'center', color: colors.textMuted, marginTop: spacing.md, opacity: 0.7 },
});
