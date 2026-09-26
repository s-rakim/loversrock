// Every drawing the two of you have kept.
//
// The canvas used to have one exit: send it into the message thread, where it
// scrolls away. That is the wrong home for the thing people spend twenty
// minutes on, so drawings now have a shelf — and, more to the point, a way
// back INTO the canvas, because the good ones are the ones both of you keep
// adding to.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, Alert, RefreshControl,
  Dimensions, TextInput, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, onSocketEvent } from '../services/api';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import { MorphButton, FadeInUp } from '../components/Motion';
import { useBarClearance } from '../components/LumaBar';
import Doodle from '../components/Doodle';

const GAP = spacing.sm;

const when = (iso) => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export default function CanvasGalleryScreen({ navigation }) {
  // The New drawing button floats, and so does the app's tab bar — at the
  // same spot. It used to sit a fixed spacing.lg from the bottom, which put it
  // squarely on the Quiz and Settings buttons.
  const clearance = useBarClearance();
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [drawings, setDrawings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [draftTitle, setDraftTitle] = useState('');

  // Two columns, measured rather than guessed, so the cells butt up against
  // the screen edges by exactly the page padding at every width.
  const cell = (Dimensions.get('window').width - spacing.md * 2 - GAP) / 2;

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/canvas');
      setDrawings(data.drawings || []);
    } catch (err) {
      Alert.alert('Could not load the gallery', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reloaded on focus rather than once on mount: you arrive here straight
  // after saving from the canvas, and a stale grid would be missing the thing
  // you just drew.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // And live, so a drawing your partner saves appears while you are looking
  // at the shelf — which is the whole point of it being shared.
  useFocusEffect(useCallback(() => {
    const off = [
      onSocketEvent('canvas:saved', () => load()),
      onSocketEvent('canvas:deleted', ({ id }) => setDrawings((p) => p.filter((d) => d.id !== id))),
    ];
    return () => off.forEach((fn) => fn && fn());
  }, [load]));

  async function open(drawing) {
    try {
      const { drawing: full } = await apiFetch(`/canvas/${drawing.id}`);
      navigation.navigate('Canvas', {
        drawingId: full.id,
        strokes: full.stroke_data?.strokes || [],
        canvasColor: full.canvas_color,
        title: full.title,
      });
    } catch (err) {
      Alert.alert('Could not open it', err.message);
    }
  }

  async function togglePin(drawing) {
    // Moved in the list first, then saved. Pinning is the one action here
    // where waiting on a round trip to see the tile move feels broken.
    setDrawings((prev) => {
      const next = prev.map((d) => (d.id === drawing.id ? { ...d, pinned: !d.pinned } : d));
      return next.sort((a, b) => (b.pinned - a.pinned)
        || (new Date(b.updated_at) - new Date(a.updated_at)));
    });
    try {
      await apiFetch(`/canvas/${drawing.id}`, { method: 'PATCH', body: { pinned: !drawing.pinned } });
    } catch (err) {
      load();
      Alert.alert('Could not pin it', err.message);
    }
  }

  async function saveTitle() {
    const target = renaming;
    setRenaming(null);
    try {
      const { drawing } = await apiFetch(`/canvas/${target.id}`, {
        method: 'PATCH', body: { title: draftTitle },
      });
      setDrawings((prev) => prev.map((d) => (d.id === drawing.id ? { ...d, title: drawing.title } : d)));
    } catch (err) {
      Alert.alert('Could not rename it', err.message);
    }
  }

  function remove(drawing) {
    Alert.alert(
      drawing.title ? `Delete “${drawing.title}”?` : 'Delete this drawing?',
      'It goes for both of you, and it does not come back.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDrawings((prev) => prev.filter((d) => d.id !== drawing.id));
            try {
              await apiFetch(`/canvas/${drawing.id}`, { method: 'DELETE' });
            } catch (err) {
              load();
              Alert.alert('Could not delete it', err.message);
            }
          },
        },
      ]
    );
  }

  const renderItem = ({ item, index }) => (
    <FadeInUp delay={Math.min(index, 8) * 40}>
      <Pressable
        onPress={() => open(item)}
        onLongPress={() => remove(item)}
        style={[styles.card, { width: cell }]}
      >
        {/* `preview` is the first forty strokes, which is what the drawing
            looked like when it was nearly done — detail comes last — so a
            thumbnail drawn from it reads as the real thing. `fit` scales it
            into the cell; without that you get its top-left corner. */}
        <Doodle
          strokeData={{ strokes: item.preview || [], canvasColor: item.canvas_color }}
          height={cell}
          fit
          radius={radius.md}
        />

        <Pressable onPress={() => togglePin(item)} hitSlop={10} style={styles.pin}>
          <Ionicons
            name={item.pinned ? 'bookmark' : 'bookmark-outline'}
            size={16}
            color={item.pinned ? colors.accent : '#FFFFFF'}
          />
        </Pressable>

        <View style={styles.caption}>
          <Pressable onPress={() => { setRenaming(item); setDraftTitle(item.title || ''); }}>
            <Text style={[font.body, styles.title]} numberOfLines={1}>
              {item.title || 'Untitled'}
            </Text>
          </Pressable>
          <Text style={[font.muted, { fontSize: 11 }]}>
            {item.stroke_count} stroke{item.stroke_count === 1 ? '' : 's'} · {when(item.updated_at)}
          </Text>
        </View>
      </Pressable>
    </FadeInUp>
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={drawings}
        keyExtractor={(d) => d.id}
        numColumns={2}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={[styles.list, { paddingBottom: clearance.content + 64 }]}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Ionicons name="color-palette-outline" size={40} color={colors.textMuted} />
              <Text style={[font.h3, { marginTop: spacing.sm }]}>Nothing on the shelf yet</Text>
              <Text style={[font.muted, styles.emptyText]}>
                Draw something and keep it. Either of you can open it again and
                add to it — the good ones are the ones you both keep touching.
              </Text>
            </View>
          )
        }
      />

      <MorphButton
        onPress={() => navigation.navigate('Canvas')}
        style={[styles.fab, { bottom: clearance.above }]}
      >
        <Ionicons name="brush" size={20} color="#fff" />
        <Text style={styles.fabText}>New drawing</Text>
      </MorphButton>

      <Modal visible={Boolean(renaming)} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable style={styles.backdrop} onPress={() => setRenaming(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={font.h2}>Name it</Text>
            <TextInput
              value={draftTitle}
              onChangeText={(t) => setDraftTitle(t.slice(0, 80))}
              placeholder="Untitled"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              autoFocus
              onSubmitEditing={saveTitle}
            />
            <MorphButton onPress={saveTitle} style={styles.save}>
              <Text style={styles.saveText}>Save</Text>
            </MorphButton>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    list: { padding: spacing.md, gap: GAP, paddingBottom: 96 },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card,
      borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    },
    pin: {
      position: 'absolute', top: spacing.xs, right: spacing.xs,
      width: 28, height: 28, borderRadius: 14,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.35)',
    },
    caption: { padding: spacing.sm },
    title: { fontWeight: '600' },
    empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: spacing.xl },
    emptyText: { textAlign: 'center', marginTop: spacing.xs },
    fab: {
      // `bottom` comes from useBarClearance at render time.
      position: 'absolute', right: spacing.md,
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      backgroundColor: colors.accent, paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md, borderRadius: radius.pill,
    },
    fabText: { color: '#fff', fontWeight: '700' },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface, padding: spacing.lg,
      borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, gap: spacing.md,
    },
    input: {
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
      padding: spacing.md, color: colors.textPrimary, backgroundColor: colors.surfaceAlt,
    },
    save: { backgroundColor: colors.accent, padding: spacing.md, borderRadius: radius.md, alignItems: 'center' },
    saveText: { color: '#fff', fontWeight: '700' },
  });
