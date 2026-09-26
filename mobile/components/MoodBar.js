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
import Character from './Character';
import useAvatars from './useAvatars';
import usePartnerMood from './usePartnerMood';
import useNudges from './useNudges';

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

// The four the server takes. The widget can only send the first — a home
// screen button has no room to ask — so this is the only way to the rest.
const NUDGES = [
  { kind: 'kiss', icon: 'heart', label: 'Kiss' },
  { kind: 'hug', icon: 'body', label: 'Hug' },
  { kind: 'thinking', icon: 'sparkles', label: 'Thinking of you' },
  { kind: 'miss', icon: 'moon', label: 'Miss you' },
];
const NUDGE_ICONS = Object.fromEntries(NUDGES.map((n) => [n.kind, n.icon]));

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
  const { theirs: theirAvatar, mine: myAvatar } = useAvatars();
  const nudges = useNudges();

  const [picking, setPicking] = useState(false);
  const [pickingNudge, setPickingNudge] = useState(false);
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);

  // A name when there is one. Without one this used to fall back to 'They',
  // used as if it were a name: "No mood from They yet", "They sees this".
  // Two forms, because the fallback starts some sentences and sits inside
  // others.
  const Who = partnerName || 'Your partner';
  const who = partnerName || 'your partner';

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
      {/* Both of you, each wearing your own mood.
          Only theirs used to be here, on the reasoning that you already know
          how you feel. In practice a card about the two of you that shows one
          person reads as half-finished, and seeing your own mood beside theirs
          is the comparison that makes the card worth looking at.

          Cropped to the face: the supplied art is full-body at roughly 0.37
          wide to tall, so at this size the whole figure is a 35px sliver with
          a twelve-pixel head. */}
      <View style={styles.faces}>
        <Character avatar={theirAvatar} mood={mood} who="partner" height={62} crop="head" />
        <Character avatar={myAvatar} mood={mine?.mood} who="me" height={62} crop="head"
          style={styles.myFace} />
      </View>

      <View style={{ flex: 1 }}>
        {nudges.unseen > 0 && (
          <Pressable onPress={nudges.markSeen} style={styles.kissBanner}>
            <Ionicons name="heart" size={13} color={colors.accentPink} />
            <Text style={styles.kissBannerText}>
              {nudges.unseen === 1 ? `${Who} kissed you` : `${nudges.unseen} kisses from ${who}`}
              {nudges.theirs ? ` · ${ago(nudges.theirs.created_at)}` : ''}
            </Text>
          </Pressable>
        )}
        {mood ? (
          <>
            <Text style={font.h3}>{Who} is feeling {LABELS[mood].toLowerCase()}</Text>
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

        <View style={styles.actionRow}>
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

          {/* The same kiss the home-screen widget sends. A throttled press —
              the pocket case — comes back sent:false, and saying "sent" for
              one would be a small lie the app tells often.

              Tap sends a kiss; hold picks which. The widget can only ever
              send a kiss, because a home-screen button has no room to ask —
              but the server has always taken four kinds, and three of them
              had no way in. */}
          <MorphButton
            onPress={() => nudges.send('kiss').catch(() => {})}
            onLongPress={() => setPickingNudge(true)}
            disabled={nudges.sending}
            style={[styles.kissButton, nudges.sending && { opacity: 0.6 }]}
          >
            <Ionicons
              name={nudges.mine ? NUDGE_ICONS[nudges.mine.kind] || 'heart' : 'heart-outline'}
              size={14}
              color={colors.accentPink}
            />
            <Text style={styles.kissText}>
              {nudges.mine ? ago(nudges.mine.created_at) : 'Kiss'}
            </Text>
          </MorphButton>
        </View>
      </View>

      <Modal visible={pickingNudge} transparent animationType="fade" onRequestClose={() => setPickingNudge(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPickingNudge(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={font.h2}>Send what?</Text>
            <View style={styles.nudgeRow}>
              {NUDGES.map((n) => (
                <Pressable
                  key={n.kind}
                  onPress={() => {
                    setPickingNudge(false);
                    nudges.send(n.kind).catch(() => {});
                  }}
                  style={styles.nudgeCell}
                >
                  <View style={styles.nudgeIcon}>
                    <Ionicons name={n.icon} size={20} color={colors.accentPink} />
                  </View>
                  <Text style={[font.muted, { fontSize: 11 }]}>{n.label}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={picking} transparent animationType="fade" onRequestClose={() => setPicking(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPicking(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={font.h2}>How are you?</Text>
            <Text style={[font.muted, { marginTop: 2 }]}>
              {Who} sees this on your mascot.
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
                      <Mascot mood={id} size={54} animated={false} drawn />
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
    // The two faces overlap slightly, which reads as a pair rather than as two
  // separate avatars that happen to be next to each other.
  faces: { flexDirection: 'row', alignItems: 'center' },
  myFace: { marginLeft: -18 },
  wrap: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: colors.surface, borderRadius: radius.card,
      padding: spacing.md, borderWidth: 1, borderColor: colors.border,
      marginBottom: spacing.md,
    },
    note: { marginTop: 2, fontStyle: 'italic' },
    actionRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
    kissButton: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      alignSelf: 'flex-start', marginTop: spacing.sm,
      paddingVertical: 6, paddingHorizontal: spacing.sm,
      borderRadius: radius.pill, backgroundColor: colors.surfaceAlt,
      borderWidth: 1, borderColor: colors.border,
    },
    kissText: { fontSize: 12, color: colors.accentPink, fontWeight: '600' },
    kissBanner: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      alignSelf: 'flex-start', marginBottom: 4,
      paddingVertical: 3, paddingHorizontal: spacing.sm,
      borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    },
    kissBannerText: { fontSize: 11, color: colors.accentPink, fontWeight: '700' },
    nudgeRow: { flexDirection: 'row', gap: spacing.sm },
    nudgeCell: { flex: 1, alignItems: 'center', gap: 4 },
    nudgeIcon: {
      width: 48, height: 48, borderRadius: 24,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
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
    // Opaque. colors.surface is a translucent card tint — 66% in dark mode —
    // and a modal drawn in it let the whole Home screen show through, so the
    // picker's grid sat on top of the Daily Prompt card behind it.
    sheet: {
      width: '100%', backgroundColor: colors.background, borderRadius: radius.card,
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
