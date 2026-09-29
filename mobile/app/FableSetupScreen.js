// Setting up the AI in Fable: which model answers, with whose key, what it is
// called and how it talks.
//
// Keys are pasted here once and go straight to our own server, which seals
// them and never sends them back — this page only ever sees "…a1b2". You can
// keep a key for several providers and switch between them; either of you
// can change anything, and the page says who set it up last.
//
// The server's own AI (QUIZ_LLM_* in backend/.env) is offered too, when it has
// one. And a key added here can also write the daily quiz, prompts and date
// ideas when backend/.env has none.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, Switch, Alert, Linking, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import { MorphButton, FadeInUp } from '../components/Motion';
import Icon from '../components/Icon';
import Icon3D from '../components/Icon3D';
import { useBarClearance } from '../components/LumaBar';

export default function FableSetupScreen({ navigation }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const clearance = useBarClearance();

  const [data, setData] = useState(null);       // what the server has
  const [form, setForm] = useState(null);       // what is on the page
  const [keyDraft, setKeyDraft] = useState('');
  const [busy, setBusy] = useState(null);       // 'save' | 'test' | 'key' | null
  const [result, setResult] = useState(null);   // { ok, text }
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch('/fable/settings');
      setData(d);
      setForm(d.settings);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loadError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[font.muted, { textAlign: 'center' }]}>{loadError}</Text>
        <MorphButton onPress={load} style={styles.secondary}><Text style={styles.secondaryText}>Try again</Text></MorphButton>
      </View>
    );
  }
  if (!data || !form) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.accent} /></View>;
  }

  const provider = data.providers.find((p) => p.id === form.provider) || data.providers[0];
  const savedKey = data.keys.find((k) => k.provider === provider.id);
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setResult(null); };

  const pickProvider = (p) => {
    const previous = data.providers.find((x) => x.id === form.provider);
    // Keep a model you typed yourself; swap one that was just the default.
    const model = !form.model || form.model === previous?.defaultModel ? p.defaultModel : form.model;
    set({ provider: p.id, model: p.id === form.provider ? form.model : model });
    setKeyDraft('');
  };

  const saveKey = async () => {
    const apiKey = keyDraft.trim();
    if (!apiKey) return;
    setBusy('key');
    try {
      const d = await apiFetch(`/fable/keys/${provider.id}`, { method: 'PUT', body: { apiKey } });
      setData((old) => ({ ...old, keys: d.keys }));
      setKeyDraft('');
      setResult({ ok: true, text: `${provider.label} key saved. Press Test to try it.` });
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const removeKey = (k) => {
    const label = data.providers.find((p) => p.id === k.provider)?.label || k.provider;
    Alert.alert(`Remove the ${label} key?`, 'The AI stops working with it until a key is added again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try {
            const d = await apiFetch(`/fable/keys/${k.provider}`, { method: 'DELETE' });
            setData((old) => ({ ...old, keys: d.keys }));
          } catch (err) { setResult({ ok: false, text: err.message }); }
        },
      },
    ]);
  };

  const test = async () => {
    setBusy('test');
    setResult(null);
    try {
      const d = await apiFetch('/fable/test', { method: 'POST', body: { ...form, apiKey: keyDraft.trim() || undefined } });
      setResult({ ok: true, text: `“${d.reply}”  (${d.model}, ${(d.ms / 1000).toFixed(1)}s)` });
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      // A key typed but not yet saved goes with it.
      if (form.source === 'key' && keyDraft.trim()) {
        const k = await apiFetch(`/fable/keys/${provider.id}`, { method: 'PUT', body: { apiKey: keyDraft.trim() } });
        setData((old) => ({ ...old, keys: k.keys }));
        setKeyDraft('');
      }
      const d = await apiFetch('/fable/settings', { method: 'PUT', body: form });
      setForm(d.settings);
      setData((old) => ({ ...old, settings: d.settings, saved: true, ready: d.ready, problem: d.problem }));
      if (d.ready) navigation.goBack();
      else setResult({ ok: false, text: `Saved, but not working yet: ${d.problem}` });
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const clearChat = () => Alert.alert('Clear the chat?', `Every message in ${form.botName} is deleted, for both of you.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear', style: 'destructive', onPress: () => apiFetch('/fable/messages', { method: 'DELETE' }).then(() => setResult({ ok: true, text: 'Chat cleared.' })).catch((e) => setResult({ ok: false, text: e.message })) },
  ]);

  const turnOff = () => Alert.alert(`Turn ${form.botName} off?`, 'It stops answering. Your saved keys and the chat are kept.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Turn off', style: 'destructive', onPress: () => apiFetch('/fable/settings', { method: 'DELETE' }).then(load).catch((e) => setResult({ ok: false, text: e.message })) },
  ]);

  const server = data.server || {};

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: clearance.above + 40 }]}
      keyboardShouldPersistTaps="handled"
    >
      <FadeInUp>
        <View style={styles.hero}>
          <Icon3D name="robot" size={52} />
          <View style={{ flex: 1 }}>
            <Text style={font.h2}>Your AI in the chat</Text>
            <Text style={font.muted}>
              {data.saved
                ? (data.ready ? `Working${form.updatedBy ? ` · set up by ${form.updatedBy}` : ''}` : data.problem)
                : 'Pick a model, add your key, and it joins your group chat.'}
            </Text>
          </View>
        </View>
      </FadeInUp>

      {/* Whose AI */}
      <FadeInUp delay={30}>
        <View style={styles.card}>
          <Text style={styles.label}>Who answers</Text>
          <View style={styles.segment}>
            {[
              { id: 'key', text: 'My own API key' },
              { id: 'server', text: "The server's AI" },
            ].map((o) => (
              <MorphButton
                key={o.id}
                onPress={() => set({ source: o.id })}
                style={[styles.segmentItem, form.source === o.id && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, form.source === o.id && styles.segmentTextActive]}>{o.text}</Text>
              </MorphButton>
            ))}
          </View>
          {form.source === 'server' ? (
            <Text style={[font.muted, { marginTop: spacing.sm }]}>
              {server.available
                ? `Uses ${server.provider} (${server.model}) from backend/.env, the same AI as the daily quiz.`
                : server.error
                  ? `The server's AI is misconfigured: ${server.error}`
                  : 'The server has no AI set up in backend/.env. Use your own key instead.'}
            </Text>
          ) : null}
        </View>
      </FadeInUp>

      {form.source === 'key' ? (
        <FadeInUp delay={60}>
          <View style={styles.card}>
            <Text style={styles.label}>Provider</Text>
            <View style={styles.chips}>
              {data.providers.map((p) => {
                const active = p.id === form.provider;
                const hasKey = data.keys.some((k) => k.provider === p.id);
                return (
                  <MorphButton key={p.id} onPress={() => pickProvider(p)} style={[styles.chip, active && styles.chipActive]}>
                    {hasKey ? <Icon name="key" chip={false} size={11} color={active ? '#fff' : colors.success} /> : null}
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
                    {p.free ? <Text style={[styles.free, active && { color: '#fff' }]}>free</Text> : null}
                  </MorphButton>
                );
              })}
            </View>

            {!provider.noKey ? (
              <>
                <Text style={[styles.label, { marginTop: spacing.md }]}>{provider.label} API key</Text>
                {savedKey ? (
                  <View style={styles.savedKey}>
                    <Icon name="lock-closed" chip={false} size={14} color={colors.success} />
                    <Text style={[font.body, { flex: 1 }]}>
                      Saved {savedKey.hint}{savedKey.addedBy ? ` · added by ${savedKey.addedBy}` : ''}
                    </Text>
                    <MorphButton onPress={() => removeKey(savedKey)} accessibilityLabel="Remove key">
                      <Icon name="trash-outline" chip={false} size={16} color={colors.danger} />
                    </MorphButton>
                  </View>
                ) : null}
                <View style={styles.keyRow}>
                  <TextInput
                    value={keyDraft}
                    onChangeText={(t) => { setKeyDraft(t); setResult(null); }}
                    placeholder={savedKey ? 'Paste a new key to replace it' : 'Paste your API key'}
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, { flex: 1 }]}
                  />
                  <MorphButton onPress={saveKey} disabled={!keyDraft.trim() || busy} style={[styles.smallButton, (!keyDraft.trim() || busy) && styles.dim]}>
                    {busy === 'key' ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.smallButtonText}>Save key</Text>}
                  </MorphButton>
                </View>
                {provider.keyUrl ? (
                  <MorphButton onPress={() => Linking.openURL(provider.keyUrl)} style={styles.linkRow}>
                    <Icon name="open-outline" chip={false} size={13} color={colors.accent} />
                    <Text style={styles.link}>
                      {provider.free ? `Get a free ${provider.label} key` : `Get a ${provider.label} key`}
                    </Text>
                  </MorphButton>
                ) : null}
                <Text style={styles.hint}>Stored on your own server, sealed. It never comes back to a phone.</Text>
              </>
            ) : (
              <Text style={[styles.hint, { marginTop: spacing.sm }]}>No key needed: Ollama runs on the server PC itself.</Text>
            )}

            <Text style={[styles.label, { marginTop: spacing.md }]}>Model</Text>
            <TextInput
              value={form.model}
              onChangeText={(t) => set({ model: t })}
              placeholder={provider.defaultModel || 'model name'}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Text style={styles.hint}>Any chat model {provider.label} offers. {provider.defaultModel ? `${provider.defaultModel} is a good start.` : ''}</Text>

            {provider.needsBaseUrl || provider.id === 'ollama' ? (
              <>
                <Text style={[styles.label, { marginTop: spacing.md }]}>Address{provider.needsBaseUrl ? '' : ' (optional)'}</Text>
                <TextInput
                  value={form.baseUrl || ''}
                  onChangeText={(t) => set({ baseUrl: t })}
                  placeholder={provider.id === 'ollama' ? 'http://host.docker.internal:11434/v1' : 'https://…/v1'}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  style={styles.input}
                />
              </>
            ) : null}

            {data.keys.filter((k) => k.provider !== provider.id).length ? (
              <>
                <Text style={[styles.label, { marginTop: spacing.md }]}>Your other keys</Text>
                {data.keys.filter((k) => k.provider !== provider.id).map((k) => (
                  <View key={k.provider} style={styles.savedKey}>
                    <Icon name="key" chip={false} size={13} color={colors.textMuted} />
                    <Text style={[font.body, { flex: 1 }]}>
                      {data.providers.find((p) => p.id === k.provider)?.label || k.provider} {k.hint}
                    </Text>
                    <MorphButton onPress={() => removeKey(k)} accessibilityLabel="Remove key">
                      <Icon name="trash-outline" chip={false} size={16} color={colors.danger} />
                    </MorphButton>
                  </View>
                ))}
              </>
            ) : null}
          </View>
        </FadeInUp>
      ) : null}

      {/* How it behaves */}
      <FadeInUp delay={90}>
        <View style={styles.card}>
          <Text style={styles.label}>Its name</Text>
          <TextInput value={form.botName} onChangeText={(t) => set({ botName: t })} maxLength={24} style={styles.input} placeholder="Fable" placeholderTextColor={colors.textMuted} />

          <Text style={[styles.label, { marginTop: spacing.md }]}>Personality (optional)</Text>
          <TextInput
            value={form.persona}
            onChangeText={(t) => set({ persona: t })}
            multiline
            maxLength={1000}
            placeholder="e.g. Funny and a bit cheeky. Loves planning dates and settling our debates."
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
          />

          <Text style={[styles.label, { marginTop: spacing.md }]}>When it replies</Text>
          <View style={styles.segment}>
            {[
              { id: 'always', text: 'Every message' },
              { id: 'mention', text: `Only when named` },
            ].map((o) => (
              <MorphButton
                key={o.id}
                onPress={() => set({ replyMode: o.id })}
                style={[styles.segmentItem, form.replyMode === o.id && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, form.replyMode === o.id && styles.segmentTextActive]}>{o.text}</Text>
              </MorphButton>
            ))}
          </View>
          <Text style={styles.hint}>
            {form.replyMode === 'mention'
              ? `It joins in when a message says @${form.botName || 'Fable'} or starts with its name.`
              : 'It answers everything either of you writes.'}
          </Text>

          {form.source === 'key' ? (
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={font.body}>Also write the daily content</Text>
                <Text style={font.muted}>
                  {server.available
                    ? 'The server already has its own AI for this, so it is used instead.'
                    : 'Fresh daily quiz questions, prompts, date ideas and challenges from this key.'}
                </Text>
              </View>
              <Switch value={Boolean(form.useForContent)} onValueChange={(v) => set({ useForContent: v })} trackColor={{ true: colors.accent }} />
            </View>
          ) : null}
        </View>
      </FadeInUp>

      {result ? (
        <View style={[styles.result, { borderColor: result.ok ? colors.success : colors.danger }]}>
          <Icon name={result.ok ? 'checkmark-circle' : 'alert-circle'} chip={false} size={16} color={result.ok ? colors.success : colors.danger} />
          <Text style={[font.body, { flex: 1 }]}>{result.text}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <MorphButton onPress={test} disabled={Boolean(busy)} style={[styles.secondary, { flex: 1 }, busy && styles.dim]}>
          {busy === 'test' ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.secondaryText}>Test</Text>}
        </MorphButton>
        <MorphButton onPress={save} disabled={Boolean(busy)} style={[styles.primary, { flex: 1 }, busy && styles.dim]}>
          {busy === 'save' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save</Text>}
        </MorphButton>
      </View>

      {data.saved ? (
        <View style={styles.dangerRow}>
          <MorphButton onPress={clearChat} style={styles.dangerButton}><Text style={styles.dangerText}>Clear chat</Text></MorphButton>
          <MorphButton onPress={turnOff} style={styles.dangerButton}><Text style={styles.dangerText}>Turn off</Text></MorphButton>
        </View>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
    content: { padding: spacing.lg, gap: spacing.md },
    hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
      padding: spacing.lg,
    },
    label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.xs },
    hint: { fontSize: 12, color: colors.textMuted, marginTop: spacing.xs },
    input: {
      backgroundColor: colors.background, color: colors.text, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border,
    },
    segment: { flexDirection: 'row', gap: spacing.xs },
    segmentItem: {
      flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.pill,
      borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
    },
    segmentActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    segmentText: { color: colors.text, fontWeight: '600', fontSize: 13 },
    segmentTextActive: { color: '#fff' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: spacing.sm,
      borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: '#fff' },
    free: { fontSize: 10, fontWeight: '700', color: colors.success, textTransform: 'uppercase' },
    savedKey: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs, marginBottom: spacing.xs,
    },
    keyRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
    smallButton: {
      backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
      minWidth: 84, alignItems: 'center',
    },
    smallButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
    link: { color: colors.accent, fontWeight: '600', fontSize: 13 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
    result: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
      borderRadius: radius.md, borderWidth: 1, backgroundColor: colors.surface,
    },
    actions: { flexDirection: 'row', gap: spacing.sm },
    primary: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: spacing.md, alignItems: 'center' },
    primaryText: { color: '#fff', fontWeight: '700' },
    secondary: {
      backgroundColor: colors.accentSoft, borderRadius: radius.pill, paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg, alignItems: 'center',
    },
    secondaryText: { color: colors.accent, fontWeight: '700' },
    dim: { opacity: 0.5 },
    dangerRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
    dangerButton: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    dangerText: { color: colors.danger, fontWeight: '600' },
  });
