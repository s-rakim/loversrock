// Asking a poll: a question, two to twelve options, one answer or several.
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, StyleSheet, Pressable, ScrollView, Switch, KeyboardAvoidingView, Platform } from 'react-native';
import { spacing, radius } from '../../theme';
import { useTheme } from '../ThemeContext';
import Icon from '../Icon';

export const MAX_OPTIONS = 12;

/** The poll as it is sent, or null while it is not complete. */
export function pollFrom(question, options, multi) {
  const q = String(question || '').trim();
  const opts = options.map((o) => String(o || '').trim()).filter(Boolean);
  if (!q || opts.length < 2) return null;
  return { question: q, options: opts.slice(0, MAX_OPTIONS), multi: Boolean(multi) };
}

export default function PollComposer({ visible, onCancel, onSend }) {
  const { colors, font } = useTheme();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  useEffect(() => {
    if (visible) { setQuestion(''); setOptions(['', '']); setMulti(false); }
  }, [visible]);
  const poll = pollFrom(question, options, multi);
  const input = [styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.scrim}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={font.h2}>New poll</Text>
          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            <TextInput
              value={question}
              onChangeText={setQuestion}
              placeholder="Ask something…"
              placeholderTextColor={colors.textMuted}
              style={[input, { marginTop: spacing.md }]}
              maxLength={200}
            />
            {options.map((value, i) => (
              <View key={i} style={styles.optionRow}>
                <TextInput
                  value={value}
                  onChangeText={(t) => setOptions((list) => list.map((o, j) => (j === i ? t : o)))}
                  placeholder={`Option ${i + 1}`}
                  placeholderTextColor={colors.textMuted}
                  style={[input, { flex: 1 }]}
                  maxLength={100}
                />
                {options.length > 2 ? (
                  <Icon name="close-circle" chip={false} size={22} color={colors.textMuted}
                    onPress={() => setOptions((list) => list.filter((_, j) => j !== i))} />
                ) : null}
              </View>
            ))}
            {options.length < MAX_OPTIONS ? (
              <Pressable onPress={() => setOptions((list) => [...list, ''])} style={styles.add}>
                <Icon name="add-circle-outline" chip={false} size={20} color={colors.accent} />
                <Text style={{ color: colors.accent, fontWeight: '600' }}>Add an option</Text>
              </Pressable>
            ) : null}
            <View style={styles.switchRow}>
              <Text style={[font.body, { flex: 1 }]}>Allow more than one answer</Text>
              <Switch value={multi} onValueChange={setMulti} />
            </View>
          </ScrollView>
          <View style={styles.buttons}>
            <Pressable onPress={onCancel} style={styles.button}><Text style={font.body}>Cancel</Text></Pressable>
            <Pressable
              onPress={() => poll && onSend(poll)}
              disabled={!poll}
              style={[styles.button, { backgroundColor: colors.accent, opacity: poll ? 1 : 0.4, borderRadius: radius.pill }]}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Send poll</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.lg },
  card: { borderRadius: radius.lg || 20, padding: spacing.lg, width: '100%', maxWidth: 520, alignSelf: 'center' },
  input: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  add: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.lg },
  button: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
});
