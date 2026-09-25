// The mascot at the top of Home, wearing your partner's mood — and the row
// that lets you set your own.
//
// Two halves of one exchange, side by side on purpose: seeing how they are
// and saying how you are belong together, and splitting them across two
// screens would make the second one a chore nobody does.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../theme';
import { useTheme } from './ThemeContext';
import { MorphButton } from './Motion';
import Mascot, { MASCOT_MOODS } from './Mascot';
import usePartnerMood from './usePartnerMood';

const LABELS = {
  happy: 'Happy', loved: 'Loved', calm: 'Calm', tired: 'Tired', stressed: 'Stressed',
  sad: 'Sad', annoyed: 'Annoyed', excited: 'Excited', lonely: 'Lonely', unwell: 'Unwell',
};

const ICONS = {
  happy: 'happy-outline', loved: 'heart-outline', calm: 'leaf-outline',
  tired: 'moon-outline', stressed: 'flash-outline', sad: 'rainy-outline',
  annoyed: 'thunderstorm-outline', excited: 'sparkles-outline',
  lonely: 'person-outline', unwell: 'medkit-outline',
};

const ago = (iso) => {
  if (!iso) return null;
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
};

export default function MoodBar({ partnerName }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { mood, note, updatedAt, mine, setMyMood } = usePartnerMood();

  const [picking, setPicking] = useState(false);
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);

  const who = partnerName || 'They';

  async function choose(next) {
    setSaving(true);
    try {
      await setMyMood(next, draftNote.trim() || null);
      setPicking(false);
      setDraftNote('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {/* THEIR mood, worn by the mascot. Not yours — you already know how you
          feel; this is for noticing them. */}
      <Mascot mood={mood} size={84} />

      <View style={{ flex: 1 }}>
        {mood ? (
          <>
            <Text style={font.h3}>{who} is feeling {LABELS[mood].toLowerCase()}</Text>
            {note ? <Text style={[font.body, styles.note]}>“{note}”</Text> : null}
            <Text style={[font.muted, { fontSize: 11 }]}>{ago(updatedAt)}</Text>
          </>
        ) : (
          <>
            <Text style={font.h3}>No mood from {who} yet</Text>
            <Text style={font.muted}>
              When they set one, this little thing wears it.
            </Text>
          </>
        )}

        <MorphButton onPress={() => setPicking(true)} style={styles.setButton}>
          <Ionicons
            name={mine ? ICONS[mine.mood] : 'add'}
            size={14}
            color={colors.accent}
          />
          <Text style={styles.setText}>
            {mine ? `You: ${LABELS[mine.mood]}` : 'Set your mood'}
          </Text>
        </MorphButton>
      </View>

      <Modal visible={picking} transparent animationType="fade" onRequestClose={() => setPicking(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPicking(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={font.h2}>How are you?</Text>
            <Text style={[font.muted, { marginTop: 2 }]}>
              {who} sees this on their mascot.
            </Text>

            <TextInput
              value={draftNote}
              onChangeText={(t) => setDraftNote(t.slice(0, 120))}
              placeholder="Add a word about it (optional)"
              placeholderTextColor={colors.textMuted}
              style={styles.noteInput}
            />

            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              <View style={styles.grid}>
                {MASCOT_MOODS.map((id) => {
                  const active = mine?.mood === id;
                  return (
                    <Pressable
                      key={id}
                      onPress={() => choose(id)}
                      disabled={saving}
                      style={[styles.cell, active && styles.cellActive]}
                    >
                      {/* The mascot itself is the swatch: you pick the face
                          you want them to see, not a word from a list. */}
                      <Mascot mood={id} size={54} animated={false} />
                      <Text style={[styles.cellLabel, active && { color: colors.accent, fontWeight: '700' }]}>
                        {LABELS[id]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    wrap: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: colors.surface, borderRadius: radius.card,
      padding: spacing.md, borderWidth: 1, borderColor: colors.border,
      marginBottom: spacing.md,
    },
    note: { marginTop: 2, fontStyle: 'italic' },
    setButton: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      alignSelf: 'flex-start', marginTop: spacing.sm,
      backgroundColor: colors.accentSoft, borderRadius: radius.pill,
      paddingHorizontal: spacing.md, paddingVertical: 6,
    },
    setText: { color: colors.accent, fontWeight: '700', fontSize: 13 },

    backdrop: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
    },
    sheet: {
      width: '100%', backgroundColor: colors.surface, borderRadius: radius.card,
      padding: spacing.lg, borderWidth: 1, borderColor: colors.border,
    },
    noteInput: {
      backgroundColor: colors.surfaceAlt, color: colors.textPrimary,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderWidth: 1, borderColor: colors.border, marginTop: spacing.md,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md },
    cell: {
      width: '25%', alignItems: 'center', paddingVertical: spacing.sm,
      borderRadius: radius.md, borderWidth: 2, borderColor: 'transparent',
    },
    cellActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    cellLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  });
