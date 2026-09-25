// Everything the two of you have done, in order.
//
// Not a copy of the message thread. The thread is what you said; this is what
// you did — the questions you both answered, the photos, the drawings, the
// dates, the things you ticked off — and each one can be commented on, which
// is the part that makes it worth having. A memory from March with two lines
// underneath it from June is the whole point.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Image, TextInput, Pressable,
  ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, mediaUrl, onSocketEvent } from '../services/api';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import { MorphButton } from '../components/Motion';

// What each kind looks like at a glance. Icon and label only — the layout is
// shared, because nine different card designs in one scroll reads as a mess
// rather than as variety.
const KIND = {
  prompt: { icon: 'help-circle-outline', label: "Today's question" },
  quiz: { icon: 'trophy-outline', label: 'Quiz' },
  memory: { icon: 'images-outline', label: 'Memory' },
  locket: { icon: 'camera-outline', label: 'Locket' },
  drawing: { icon: 'brush-outline', label: 'Drawing' },
  date: { icon: 'calendar-outline', label: 'Date' },
  bucket: { icon: 'checkmark-done-outline', label: 'Ticked off' },
  challenge: { icon: 'dice-outline', label: 'Challenge' },
  checkin: { icon: 'clipboard-outline', label: 'Check-in' },
  milestone: { icon: 'ribbon-outline', label: 'Milestone' },
};

const when = (iso) => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
};

export default function FeedScreen({ navigation }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [me, setMe] = useState(null);
  // A second page request in flight must not start a third, or a fast scroll
  // fetches the same page four times.
  const loadingMore = useRef(false);

  const load = useCallback(async () => {
    try {
      const [feed, profile] = await Promise.all([
        apiFetch('/feed'),
        apiFetch('/profile').catch(() => null),
      ]);
      setItems(feed.items);
      setCursor(feed.nextCursor);
      if (profile?.me?.id) setMe(profile.me.id);
    } catch (err) {
      Alert.alert('Could not load the feed', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useFocusEffect(useCallback(() => onSocketEvent('feed:comment', () => load()), [load]));

  const more = useCallback(async () => {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await apiFetch(
        `/feed?cursorAt=${encodeURIComponent(cursor.at)}&cursorId=${cursor.id}`
      );
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      // A failed page is not worth an alert; pulling down retries.
    } finally {
      loadingMore.current = false;
    }
  }, [cursor]);

  async function comment(item) {
    const key = `${item.kind}:${item.id}`;
    const body = (drafts[key] || '').trim();
    if (!body) return;
    setDrafts((d) => ({ ...d, [key]: '' }));
    try {
      const res = await apiFetch(`/feed/${item.kind}/${item.id}/comments`, { method: 'POST', body: { body } });
      setItems((prev) => prev.map((i) => (i.id === item.id && i.kind === item.kind
        ? { ...i, comments: [...i.comments, res.comment] } : i)));
    } catch (err) {
      setDrafts((d) => ({ ...d, [key]: body }));
      Alert.alert('Could not post that', err.message);
    }
  }

  async function removeComment(item, c) {
    try {
      await apiFetch(`/feed/comments/${c.id}`, { method: 'DELETE' });
      setItems((prev) => prev.map((i) => (i.id === item.id && i.kind === item.kind
        ? { ...i, comments: i.comments.filter((x) => x.id !== c.id) } : i)));
    } catch (err) {
      Alert.alert('Could not delete that', err.message);
    }
  }

  const body = (item) => {
    switch (item.kind) {
      case 'memory':
      case 'locket':
        return (
          <>
            <Image source={{ uri: mediaUrl(item.image) }} style={styles.photo} resizeMode="cover" />
            {item.body ? <Text style={[font.body, styles.caption]}>{item.body}</Text> : null}
          </>
        );
      case 'drawing':
        // The feed does not carry strokes — thirty jsonb blobs to show thirty
        // thumbnails is exactly the weight the gallery's split avoids. So the
        // card says what it is and opens the real thing.
        return (
          <Pressable onPress={() => navigation.navigate('Play')}>
            <View style={[styles.drawingChip, { backgroundColor: item.meta?.canvasColor || colors.surfaceAlt }]}>
              <Ionicons name="brush" size={18} color={colors.textPrimary} />
            </View>
            <Text style={font.h3}>{item.title || 'Untitled'}</Text>
            <Text style={font.muted}>
              {item.meta?.strokeCount} stroke{item.meta?.strokeCount === 1 ? '' : 's'} · tap to open
            </Text>
          </Pressable>
        );
      case 'prompt':
        return (
          <>
            <Text style={[font.h3, styles.question]}>{item.title}</Text>
            {(item.meta?.answers || []).map((a, i) => (
              <View key={a.userId + i} style={styles.answer}>
                <Text style={[font.muted, { fontSize: 11, fontWeight: '700' }]}>
                  {a.userId === me ? 'YOU' : 'THEM'}
                </Text>
                <Text style={font.body}>{a.text}</Text>
              </View>
            ))}
          </>
        );
      case 'quiz':
        return (
          <Text style={font.h3}>
            {item.meta?.correct ?? 0} of {item.meta?.total ?? 0} matched
          </Text>
        );
      case 'checkin':
        return <Text style={font.h3}>You both finished the check-in</Text>;
      default:
        return (
          <>
            {item.title ? <Text style={font.h3}>{item.title}</Text> : null}
            {item.body ? <Text style={[font.body, styles.caption]}>{item.body}</Text> : null}
          </>
        );
    }
  };

  const renderItem = ({ item }) => {
    const key = `${item.kind}:${item.id}`;
    const meta = KIND[item.kind] || { icon: 'ellipse-outline', label: item.kind };

    return (
      <View style={styles.card}>
        <View style={styles.head}>
          <Ionicons name={meta.icon} size={14} color={colors.accent} />
          <Text style={styles.kindLabel}>{meta.label.toUpperCase()}</Text>
          <Text style={[font.muted, { fontSize: 11 }]}>{when(item.at)}</Text>
        </View>

        {body(item)}

        {item.reactions.length > 0 && (
          <View style={styles.reactions}>
            {item.reactions.map((r, i) => (
              <Text key={r.userId + i} style={styles.reaction}>{r.emoji}</Text>
            ))}
          </View>
        )}

        {item.comments.map((c) => (
          <Pressable
            key={c.id}
            // Your own only — deleting each other's words is not something a
            // two-person app should make easy during an argument.
            onLongPress={() => (c.authorId === me ? removeComment(item, c) : null)}
            style={styles.comment}
          >
            <Text style={[font.muted, { fontSize: 11, fontWeight: '700' }]}>
              {c.authorId === me ? 'You' : 'Them'}
            </Text>
            <Text style={font.body}>{c.body}</Text>
          </Pressable>
        ))}

        <View style={styles.commentRow}>
          <TextInput
            value={drafts[key] || ''}
            onChangeText={(t) => setDrafts((d) => ({ ...d, [key]: t }))}
            placeholder="Say something about this…"
            placeholderTextColor={colors.textMuted}
            style={styles.commentInput}
            onSubmitEditing={() => comment(item)}
            returnKeyType="send"
          />
          <MorphButton onPress={() => comment(item)} style={styles.send}>
            <Ionicons name="arrow-up" size={15} color="#fff" />
          </MorphButton>
        </View>
      </View>
    );
  };

  if (loading) return <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>;

  return (
    <FlatList
      style={styles.root}
      data={items}
      keyExtractor={(i) => `${i.kind}:${i.id}`}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      onEndReached={more}
      onEndReachedThreshold={0.4}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.accent}
        />
      }
      ListFooterComponent={cursor ? <ActivityIndicator style={{ margin: spacing.lg }} color={colors.accent} /> : null}
      ListEmptyComponent={(
        <View style={styles.empty}>
          <Ionicons name="time-outline" size={40} color={colors.textMuted} />
          <Text style={[font.h3, { marginTop: spacing.sm }]}>Nothing here yet</Text>
          <Text style={[font.muted, styles.emptyText]}>
            Answer a question, send a photo, tick something off — it all lands
            here, and you can talk about any of it afterwards.
          </Text>
        </View>
      )}
    />
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    list: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card,
      padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.xs,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    kindLabel: {
      flex: 1, fontSize: 10, fontWeight: '800', letterSpacing: 1, color: colors.accent,
    },
    photo: { width: '100%', height: 220, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
    drawingChip: {
      width: 44, height: 44, borderRadius: radius.md, marginBottom: spacing.xs,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: colors.border,
    },
    caption: { marginTop: 2 },
    question: { marginBottom: spacing.xs },
    answer: {
      backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
      padding: spacing.sm, marginTop: spacing.xs,
    },
    reactions: { flexDirection: 'row', gap: 4, marginTop: 2 },
    reaction: { fontSize: 16 },
    comment: {
      paddingTop: spacing.sm, marginTop: spacing.xs,
      borderTopWidth: 1, borderTopColor: colors.border,
    },
    commentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
    commentInput: {
      flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
      paddingHorizontal: spacing.md, paddingVertical: 8,
      color: colors.textPrimary, backgroundColor: colors.surfaceAlt, fontSize: 13,
    },
    send: {
      width: 34, height: 34, borderRadius: 17,
      alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent,
    },
    empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: spacing.xl },
    emptyText: { textAlign: 'center', marginTop: spacing.xs },
  });
