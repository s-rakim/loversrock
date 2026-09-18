import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { apiFetch, setTokens } from '../services/api';
import { colors, font, spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';
import StickerField, { HeartShape } from '../components/Stickers';

export default function LoginScreen({ navigation }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!email || !password || (mode === 'signup' && !name)) {
      Alert.alert('Missing info', 'Please fill in every field.');
      return;
    }
    setLoading(true);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/signup';
      const body = mode === 'login' ? { email, password } : { name, email, password };
      const data = await apiFetch(path, { method: 'POST', body });
      await setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });

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
      </FadeInUp>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: spacing.lg },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
});
