// Setting up the AI in Fable: which connection answers, what it is called and
// how it talks.
//
// A connection is any endpoint you define: a name, an address, a key and a
// model (Collaboration des Esprits' connection layer; see the backend's
// models/aiConnections.js). Presets only fill the boxes in, free tiers first,
// and nothing is chosen for you: Free Claude Code is one preset among them,
// for when it happens to be running on the PC, never a requirement.
//
// Keys go straight to our own server, sealed, and never come back: a row shows
// the key's length and last four characters, which is how a key cut off when
// it was copied shows itself. Or paste the provider's whole example and the
// server reads the address, key and model out of it.
//
// Find asks the endpoint itself: it repairs the address (a missing /v1,
// Google's /v1beta/openai), lists the models it really serves, and proves the
// key with a one-token call. Test has Fable say hello through it.
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

const at = (name, tail = '') => `/fable/connections/${encodeURIComponent(name)}${tail}`;

/** "integrate.api.nvidia.com" from an address, for the row's second line. */
export function hostOf(url) {
  const m = /^https?:\/\/([^/:]+)/i.exec(String(url || ''));
  return m ? m[1] : '';
}

/** What a row says about its key, never the key itself. */
export function keyLine(c) {
  if (c.keyUnreadable) return 'key can no longer be read: paste it again';
  if (!c.keySet) return /localhost|127\.0\.0\.1|host\.docker\.internal|192\.168\.|\/\/10\./.test(c.baseURL) ? 'no key (on the PC)' : 'no key yet';
  return `key: ${c.keyLength} characters ${c.keyPreview}`;
}

export default function FableSetupScreen({ navigation }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const clearance = useBarClearance();

  const [data, setData] = useState(null);       // what the server has
  const [form, setForm] = useState(null);       // how Fable behaves, as on the page
  const [editor, setEditor] = useState(null);   // the connection being added or changed
  const [snippet, setSnippet] = useState('');
  const [busy, setBusy] = useState(null);       // 'save' | 'test' | 'paste' | 'edit' | 'find:<name>' | 'test:<name>'
  const [result, setResult] = useState(null);   // { ok, text }
  const [notes, setNotes] = useState({});       // per row: { ok, text, models }
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

  const connections = data.connections || [];
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setResult(null); };
  const note = (name, value) => setNotes((n) => ({ ...n, [name]: value }));
  const withConnections = (list) => setData((old) => ({ ...old, connections: list }));
  const afterSettings = (d) => setData((old) => ({ ...old, settings: d.settings, saved: true, ready: d.ready, problem: d.problem }));

  /** Fable answers through this one from now on, for both of you. */
  const choose = async (name) => {
    set({ source: 'key', connection: name });
    try {
      const d = await apiFetch('/fable/settings', { method: 'PUT', body: { ...form, source: 'key', connection: name } });
      setForm(d.settings);
      afterSettings(d);
    } catch (err) { setResult({ ok: false, text: err.message }); }
  };

  const find = async (name) => {
    setBusy(`find:${name}`);
    note(name, null);
    try {
      const d = await apiFetch(at(name, '/find'), { method: 'POST', body: {} });
      const parts = [];
      if (d.changed) parts.push(`Address corrected to ${d.baseURL}.`);
      if (d.clearedModel) parts.push(`It does not serve "${d.clearedModel}".`);
      parts.push(d.key.ok ? `The key works, with ${d.key.model}.` : `The address answers, but: ${d.key.error}`);
      note(name, { ok: d.key.ok, text: parts.join(' '), models: d.models });
    } catch (err) {
      note(name, { ok: false, text: err.message, models: err.body?.models });
    } finally {
      setBusy(null);
      load();
    }
  };

  const testRow = async (name) => {
    setBusy(`test:${name}`);
    note(name, null);
    try {
      const d = await apiFetch(at(name, '/test'), { method: 'POST', body: { botName: form.botName } });
      note(name, {
        ok: true,
        text: `“${d.reply}”  (${d.model}, ${(d.ms / 1000).toFixed(1)}s)`
          + (d.fallback ? `\n${d.fallback.from} could not answer, so ${d.fallback.to} did: ${d.fallback.why}` : ''),
      });
    } catch (err) {
      note(name, { ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const pickModel = async (name, model) => {
    try {
      const d = await apiFetch(at(name), { method: 'PUT', body: { model } });
      withConnections(d.connections);
      note(name, { ...(notes[name] || {}), ok: true, text: `Using ${model}. Press Test to hear it.` });
      load();
    } catch (err) { note(name, { ok: false, text: err.message }); }
  };

  const remove = (c) => Alert.alert(`Remove “${c.name}”?`, 'Its key is deleted from the server.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Remove', style: 'destructive',
      onPress: async () => {
        try {
          const d = await apiFetch(at(c.name), { method: 'DELETE' });
          withConnections(d.connections);
          load();
        } catch (err) { setResult({ ok: false, text: err.message }); }
      },
    },
  ]);

  const openEditor = (c) => {
    setResult(null);
    setEditor(c
      ? { original: c.name, name: c.name, baseURL: c.baseURL, model: c.model, apiKey: '', extra: c.extra || {}, saved: c }
      : { original: null, name: '', baseURL: '', model: '', apiKey: '', extra: {}, preset: null });
  };

  const usePreset = (p) => setEditor((e) => ({
    ...e,
    preset: p,
    name: e.original ? e.name : p.preset.replace(/\s*\(.*\)$/, '').replace(/[^A-Za-z0-9 ._-]/g, '').trim(),
    baseURL: p.baseURL,
    model: p.model || '',
    extra: p.extra || {},
  }));

  /** Saves the row, makes it Fable's when there is none yet, then runs Find on it. */
  const saveEditor = async () => {
    const e = editor;
    const handle = e.original || e.name.trim();
    if (!handle) { setResult({ ok: false, text: 'Give the connection a name.' }); return; }
    setBusy('edit');
    try {
      const d = await apiFetch(at(handle), {
        method: 'PUT',
        body: {
          baseURL: e.baseURL.trim(),
          model: e.model.trim(),
          ...(e.apiKey.trim() ? { apiKey: e.apiKey } : {}),
          extra: e.extra,
          ...(e.original && e.name.trim() !== e.original ? { rename: e.name.trim() } : {}),
          use: !form.connection || form.connection === e.original,
        },
      });
      withConnections(d.connections);
      setEditor(null);
      setBusy(null);
      await find(d.name);
    } catch (err) {
      setResult({ ok: false, text: err.message });
      setBusy(null);
    }
  };

  /** The provider's example, read on the server: address, key, model. */
  const readSnippet = async () => {
    if (!snippet.trim()) return;
    setBusy('paste');
    setResult(null);
    try {
      const d = await apiFetch('/fable/connections/from-snippet', { method: 'POST', body: { snippet } });
      const f = d.found;
      const read = [
        f.baseURL ? `address ${f.baseURL}` : null,
        f.model ? `model ${f.model}` : null,
        f.key ? `a key of ${f.key}` : 'no key (paste it on the row)',
      ].filter(Boolean).join(', ');
      setSnippet('');
      setResult({
        ok: d.check?.ok !== false,
        text: `Read ${read}. Saved as “${d.name}”, and Fable uses it now.`
          + (d.check ? (d.check.ok ? ` It works, with ${d.check.model}.` : `\nBut: ${d.check.error}`) : ''),
      });
      if (d.check?.models) note(d.name, { ok: d.check.ok, text: d.check.ok ? 'Tap a model to switch.' : d.check.error, models: d.check.models });
      await load();
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    setResult(null);
    try {
      const d = await apiFetch('/fable/test', { method: 'POST', body: form });
      setResult({
        ok: true,
        text: `“${d.reply}”  (${d.connection} · ${d.model}, ${(d.ms / 1000).toFixed(1)}s)`
          + (d.fallback ? `\n\n${d.fallback.from} could not answer (${d.fallback.why}), so ${d.fallback.to} did.` : ''),
      });
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      const d = await apiFetch('/fable/settings', { method: 'PUT', body: form });
      setForm(d.settings);
      afterSettings(d);
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

  const turnOff = () => Alert.alert(`Turn ${form.botName} off?`, 'It stops answering. Your connections and the chat are kept.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Turn off', style: 'destructive', onPress: () => apiFetch('/fable/settings', { method: 'DELETE' }).then(load).catch((e) => setResult({ ok: false, text: e.message })) },
  ]);

  const server = data.server || {};
  const editorPreset = editor?.preset;
  const editingSaved = editor?.saved;

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
                : 'Add a connection to any AI service, and it joins your group chat.'}
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
              { id: 'key', text: 'One of my connections' },
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
                  : 'The server has no AI set up in backend/.env. Use one of your connections instead.'}
            </Text>
          ) : null}
        </View>
      </FadeInUp>

      {form.source === 'key' ? (
        <>
          {/* Paste the example */}
          <FadeInUp delay={60}>
            <View style={styles.card}>
              <Text style={styles.label}>Paste the example</Text>
              <Text style={styles.hint}>
                The page where you made the key shows an example (curl, Python or JavaScript). Paste all of it:
                the address, key and model are read out of it, and it is checked straight away.
              </Text>
              <TextInput
                value={snippet}
                onChangeText={(t) => { setSnippet(t); setResult(null); }}
                placeholder={'curl "https://…/chat/completions" \\\n  -H "Authorization: Bearer …"'}
                placeholderTextColor={colors.textMuted}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, styles.code, { marginTop: spacing.sm }]}
              />
              <MorphButton
                onPress={readSnippet}
                disabled={!snippet.trim() || Boolean(busy)}
                style={[styles.smallButton, { alignSelf: 'flex-start', marginTop: spacing.sm }, (!snippet.trim() || busy) && styles.dim]}
              >
                {busy === 'paste' ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.smallButtonText}>Read it</Text>}
              </MorphButton>
            </View>
          </FadeInUp>

          {/* The connections */}
          <FadeInUp delay={90}>
            <View style={styles.card}>
              <Text style={styles.label}>Connections</Text>
              {!connections.length ? (
                <Text style={styles.hint}>None yet. Paste an example above, or add one below. Gemini's free key is a good start.</Text>
              ) : null}
              {connections.map((c) => {
                const chosen = form.connection === c.name;
                const n = notes[c.name];
                return (
                  <View key={c.name} style={[styles.row, chosen && styles.rowChosen]}>
                    <MorphButton onPress={() => choose(c.name)} style={styles.rowHead} accessibilityLabel={`Use ${c.name}`}>
                      <Icon name={chosen ? 'radio-button-on' : 'radio-button-off'} chip={false} size={18} color={chosen ? colors.accent : colors.textMuted} />
                      <View style={{ flex: 1 }}>
                        <Text style={font.body}>{c.name}{chosen ? '  · Fable uses this' : ''}</Text>
                        <Text style={styles.sub} numberOfLines={1}>
                          {hostOf(c.baseURL) || 'no address'} · {c.model || 'no model: press Find'}{c.extra?.api === 'messages' ? ' · Anthropic shape' : ''}
                        </Text>
                        <Text style={[styles.sub, /^(no key yet|key can no)/.test(keyLine(c)) && { color: colors.danger }]}>{keyLine(c)}</Text>
                      </View>
                    </MorphButton>
                    <View style={styles.rowActions}>
                      <MorphButton onPress={() => find(c.name)} disabled={Boolean(busy)} style={[styles.rowButton, busy && styles.dim]}>
                        {busy === `find:${c.name}` ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={styles.rowButtonText}>Find</Text>}
                      </MorphButton>
                      <MorphButton onPress={() => testRow(c.name)} disabled={Boolean(busy)} style={[styles.rowButton, busy && styles.dim]}>
                        {busy === `test:${c.name}` ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={styles.rowButtonText}>Test</Text>}
                      </MorphButton>
                      <MorphButton onPress={() => openEditor(c)} style={styles.rowButton}><Text style={styles.rowButtonText}>Edit</Text></MorphButton>
                      <MorphButton onPress={() => remove(c)} style={styles.rowIcon} accessibilityLabel={`Remove ${c.name}`}>
                        <Icon name="trash-outline" chip={false} size={16} color={colors.danger} />
                      </MorphButton>
                    </View>
                    {n ? <Text style={[styles.note, { color: n.ok ? colors.text : colors.danger }]}>{n.text}</Text> : null}
                    {n?.models?.length ? (
                      <View style={[styles.chips, { marginTop: spacing.xs }]}>
                        {n.models.slice(0, 12).map((m) => (
                          <MorphButton key={m} onPress={() => pickModel(c.name, m)} style={[styles.chip, m === c.model && styles.chipActive]}>
                            <Text style={[styles.chipText, m === c.model && styles.chipTextActive]}>{m}</Text>
                          </MorphButton>
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}

              {editor ? (
                <View style={styles.editor}>
                  <Text style={styles.label}>{editor.original ? `Change “${editor.original}”` : 'New connection'}</Text>
                  {!editor.original ? (
                    <>
                      <Text style={styles.hint}>Start from one of these, or type any address.</Text>
                      <View style={[styles.chips, { marginTop: spacing.xs }]}>
                        {(data.presets || []).map((p) => {
                          const active = editorPreset?.preset === p.preset;
                          return (
                            <MorphButton key={p.preset} onPress={() => usePreset(p)} style={[styles.chip, active && styles.chipActive]}>
                              <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.preset}</Text>
                              {p.free ? <Text style={[styles.free, active && { color: '#fff' }]}>free</Text> : null}
                            </MorphButton>
                          );
                        })}
                      </View>
                      {editorPreset ? (
                        <View style={{ marginTop: spacing.xs }}>
                          <Text style={styles.hint}>{editorPreset.keyHint}</Text>
                          {editorPreset.keyUrl ? (
                            <MorphButton onPress={() => Linking.openURL(editorPreset.keyUrl)} style={styles.linkRow}>
                              <Icon name="open-outline" chip={false} size={13} color={colors.accent} />
                              <Text style={styles.link}>Get a key</Text>
                            </MorphButton>
                          ) : null}
                        </View>
                      ) : null}
                    </>
                  ) : null}

                  <Text style={[styles.label, { marginTop: spacing.md }]}>Name</Text>
                  <TextInput value={editor.name} onChangeText={(t) => setEditor((e) => ({ ...e, name: t }))} maxLength={64}
                    placeholder="Gemini" placeholderTextColor={colors.textMuted} autoCorrect={false} style={styles.input} />

                  <Text style={[styles.label, { marginTop: spacing.md }]}>Address</Text>
                  <TextInput value={editor.baseURL} onChangeText={(t) => setEditor((e) => ({ ...e, baseURL: t }))}
                    placeholder="https://…/v1" placeholderTextColor={colors.textMuted}
                    autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.input} />

                  <Text style={[styles.label, { marginTop: spacing.md }]}>API key</Text>
                  <TextInput
                    value={editor.apiKey}
                    onChangeText={(t) => setEditor((e) => ({ ...e, apiKey: t }))}
                    placeholder={editingSaved?.keySet
                      ? `Leave empty to keep the saved one (${editingSaved.keyLength} characters ${editingSaved.keyPreview})`
                      : editorPreset?.keyOptional ? 'Not needed' : 'Paste the key, or the whole line it is in'}
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />
                  {editor.apiKey.trim() ? (
                    <Text style={styles.hint}>{editor.apiKey.trim().length} characters pasted, ending “{editor.apiKey.trim().slice(-4)}”. The server takes the key out of any quotes or “Bearer” around it.</Text>
                  ) : null}

                  <Text style={[styles.label, { marginTop: spacing.md }]}>Model</Text>
                  <TextInput value={editor.model} onChangeText={(t) => setEditor((e) => ({ ...e, model: t }))}
                    placeholder="Leave empty: Find picks one that answers" placeholderTextColor={colors.textMuted}
                    autoCapitalize="none" autoCorrect={false} style={styles.input} />

                  <View style={styles.switchRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={font.body}>Anthropic shape</Text>
                      <Text style={font.muted}>/messages with x-api-key: Claude, or Free Claude Code when it is running.</Text>
                    </View>
                    <Switch
                      value={editor.extra?.api === 'messages'}
                      onValueChange={(v) => setEditor((e) => {
                        const { api, ...rest } = e.extra || {};
                        return { ...e, extra: v ? { ...rest, api: 'messages' } : rest };
                      })}
                      trackColor={{ true: colors.accent }}
                    />
                  </View>

                  <View style={[styles.actions, { marginTop: spacing.md }]}>
                    <MorphButton onPress={() => setEditor(null)} style={[styles.secondary, { flex: 1 }]}><Text style={styles.secondaryText}>Cancel</Text></MorphButton>
                    <MorphButton onPress={saveEditor} disabled={Boolean(busy)} style={[styles.primary, { flex: 1 }, busy && styles.dim]}>
                      {busy === 'edit' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save and Find</Text>}
                    </MorphButton>
                  </View>
                </View>
              ) : (
                <MorphButton onPress={() => openEditor(null)} style={styles.linkRow}>
                  <Icon name="add-circle-outline" chip={false} size={16} color={colors.accent} />
                  <Text style={styles.link}>Add a connection</Text>
                </MorphButton>
              )}
              <Text style={styles.hint}>Keys are stored on your own server, sealed, and never come back to a phone.</Text>
            </View>
          </FadeInUp>
        </>
      ) : null}

      {/* How it behaves */}
      <FadeInUp delay={120}>
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
              { id: 'mention', text: 'Only when named' },
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
                    : 'Fresh daily quiz questions, prompts, date ideas and challenges through this connection.'}
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
    sub: { fontSize: 12, color: colors.textMuted },
    note: { fontSize: 13, marginTop: spacing.xs },
    input: {
      backgroundColor: colors.background, color: colors.text, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border,
    },
    code: { minHeight: 90, textAlignVertical: 'top', fontFamily: 'monospace', fontSize: 12 },
    segment: { flexDirection: 'row', gap: spacing.xs },
    segmentItem: {
      flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.pill,
      borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
    },
    segmentActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    segmentText: { color: colors.text, fontWeight: '600', fontSize: 13 },
    segmentTextActive: { color: '#fff' },
    row: {
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm,
      marginTop: spacing.sm, backgroundColor: colors.background,
    },
    rowChosen: { borderColor: colors.accent },
    rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    rowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' },
    rowButton: {
      backgroundColor: colors.accentSoft, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: spacing.md,
      minWidth: 56, alignItems: 'center',
    },
    rowButtonText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
    rowIcon: { padding: 6, marginLeft: 'auto' },
    editor: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: spacing.sm,
      borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: '#fff' },
    free: { fontSize: 10, fontWeight: '700', color: colors.success, textTransform: 'uppercase' },
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
