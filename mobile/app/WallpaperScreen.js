// Choosing what sits behind your message thread.
//
// Yours alone — the note at the bottom says so, because in a two-person app
// it is a fair assumption that changing something changes it for both of
// you, and here it does not.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, mediaUrl } from '../services/api';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import { Stagger, MorphButton, Pop } from '../components/Motion';
import Wallpaper, { WALLPAPERS, WallpaperSwatch, PHOTO_PREFIX, photoKeyOf } from '../components/Wallpaper';

export default function WallpaperScreen({ navigation }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [chosen, setChosen] = useState(null);
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    Promise.allSettled([apiFetch('/profile'), apiFetch('/memories')])
      .then(([profile, mem]) => {
        if (profile.status === 'fulfilled') setChosen(profile.value?.me?.chatWallpaper || 'none');
        if (mem.status === 'fulfilled') setMemories((mem.value.memories || []).slice(0, 24));
      })
      .finally(() => setLoading(false));
  }, []);
  useFocusEffect(load);

  async function save(value) {
    const previous = chosen;
    // Applied immediately — the preview above is the whole point, and
    // waiting on a round trip to see it would make picking feel broken.
    setChosen(value);
    setSaving(true);
    try {
      await apiFetch('/profile/preferences', { method: 'PATCH', body: { chatWallpaper: value } });
    } catch (err) {
      setChosen(previous);
      Alert.alert('Could not save', err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accentPink} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stagger delayStep={55}>
        <View style={styles.previewWrap}>
          <Wallpaper value={chosen} style={styles.preview}>
            <View style={styles.previewInner}>
              <View style={[styles.bubble, styles.theirs]}>
                <Text style={font.body}>How's your day going?</Text>
              </View>
              <View style={[styles.bubble, styles.mine]}>
                <Text style={[font.body, { color: '#fff' }]}>Better now</Text>
              </View>
            </View>
          </Wallpaper>
          {saving && (
            <View style={styles.savingPill}>
              <ActivityIndicator color={colors.accentPink} size="small" />
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={font.h3}>Backgrounds</Text>
          <View style={styles.grid}>
            {WALLPAPERS.map((w) => (
              <Pressable key={w.id} onPress={() => save(w.id)} style={styles.cell}>
                <Pop active={chosen === w.id}>
                  <View style={[styles.swatchWrap, chosen === w.id && styles.selected]}>
                    <WallpaperSwatch value={w.id} />
                    {chosen === w.id && (
                      <View style={styles.tick}>
                        <Ionicons name="checkmark" size={13} color="#fff" />
                      </View>
                    )}
                  </View>
                </Pop>
                <Text style={[font.muted, styles.label]}>{w.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={font.h3}>One of yours</Text>
          <Text style={[font.muted, { marginTop: 2 }]}>
            Any photo from your Memories. It's dimmed behind the messages so
            they stay readable.
          </Text>

          {memories.length === 0 ? (
            <Text style={[font.muted, { marginTop: spacing.md }]}>
              No memories yet — add some and they'll show up here.
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }}>
              {memories.map((m) => {
                const value = `${PHOTO_PREFIX}${m.image_url}`;
                const active = photoKeyOf(chosen) === m.image_url;
                return (
                  <Pressable key={m.id} onPress={() => save(value)} style={{ marginRight: spacing.sm }}>
                    <Pop active={active}>
                      <View style={[styles.swatchWrap, active && styles.selected]}>
                        <WallpaperSwatch value={value} />
                        {active && (
                          <View style={styles.tick}>
                            <Ionicons name="checkmark" size={13} color="#fff" />
                          </View>
                        )}
                      </View>
                    </Pop>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>

        <MorphButton onPress={() => navigation.goBack()} style={styles.done}>
          <Text style={styles.doneText}>Done</Text>
        </MorphButton>

        <View style={styles.noteRow}>
          <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
          <Text style={[font.muted, { flex: 1, marginLeft: spacing.sm }]}>
            This is yours alone. Your partner keeps whatever they chose, and
            it follows you if you sign in on another phone.
          </Text>
        </View>
      </Stagger>
    </ScrollView>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    content: { padding: spacing.lg, paddingBottom: spacing.xl },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
    previewWrap: {
      height: 190, borderRadius: radius.card, overflow: 'hidden',
      borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
    },
    preview: { flex: 1 },
    previewInner: { flex: 1, padding: spacing.md, justifyContent: 'center', gap: spacing.sm },
    bubble: { borderRadius: radius.md, padding: spacing.sm, maxWidth: '78%' },
    theirs: { backgroundColor: colors.surface, alignSelf: 'flex-start' },
    mine: { backgroundColor: colors.accentPink, alignSelf: 'flex-end' },
    savingPill: { position: 'absolute', top: spacing.sm, right: spacing.sm },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md,
      marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
    cell: { width: '25%', alignItems: 'center', marginBottom: spacing.md },
    swatchWrap: {
      borderRadius: 14, padding: 2,
      borderWidth: 2, borderColor: 'transparent',
    },
    selected: { borderColor: colors.accentPink },
    tick: {
      position: 'absolute', right: -2, bottom: -2,
      width: 22, height: 22, borderRadius: 11,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.accentPink,
      borderWidth: 2, borderColor: colors.surface,
    },
    label: { fontSize: 11, marginTop: 4 },
    done: {
      backgroundColor: colors.accentPink, borderRadius: radius.pill,
      paddingVertical: spacing.md, alignItems: 'center',
    },
    doneText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    noteRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.md },
  });
