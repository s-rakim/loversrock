// Everything the two of you have shared in the chat, by kind: photos,
// drawings, places, polls and links (Nextcloud Talk's "Shared items").
// Tapping one goes back to it in the chat.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Image, Pressable, Linking, Platform, useWindowDimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, mediaUrl } from '../services/api';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import Icon from '../components/Icon';
import Doodle from '../components/Doodle';
import useDecrypted from '../components/chat/useDecrypted';
import { isDeleted, linksIn, parseBody, mapsUrl, whenLabel } from '../components/chat/chatModel';

const TABS = [
  { key: 'photo', label: 'Photos', icon: 'images-outline' },
  { key: 'doodle', label: 'Drawings', icon: 'brush-outline' },
  { key: 'location', label: 'Places', icon: 'location-outline' },
  { key: 'poll', label: 'Polls', icon: 'stats-chart-outline' },
  { key: 'link', label: 'Links', icon: 'link-outline' },
];

/** The shared items of one kind, newest first. Links come out of texts. */
export function sharedOf(messages, kind, textOf) {
  const live = messages.filter((m) => !isDeleted(m) && !m.scheduled_for);
  if (kind === 'link') {
    return live
      .filter((m) => m.type === 'text')
      .reverse()
      .flatMap((m) => linksIn(textOf(m)).map((url) => ({ id: `${m.id}|${url}`, message: m, url })));
  }
  return live.filter((m) => m.type === kind).map((m) => ({ id: m.id, message: m })).reverse();
}

export default function SharedItemsScreen({ navigation }) {
  const { colors, font } = useTheme();
  const { width } = useWindowDimensions();
  const [messages, setMessages] = useState([]);
  const [partnerKey, setPartnerKey] = useState(null);
  const [tab, setTab] = useState('photo');
  const { textOf } = useDecrypted(messages, partnerKey);

  useFocusEffect(useCallback(() => {
    apiFetch('/profile').then((d) => setPartnerKey(d?.partner?.publicKey || null)).catch(() => {});
    apiFetch('/messages').then((d) => setMessages(d.messages || [])).catch(() => {});
  }, []));

  const items = useMemo(() => sharedOf(messages, tab, textOf), [messages, tab, textOf]);
  const grid = tab === 'photo' || tab === 'doodle';
  // As many columns as fit: three on a phone, more on a tablet.
  const columns = grid ? Math.max(3, Math.floor(Math.min(width, 1100) / 150)) : 1;
  const tile = (Math.min(width, 1100) - spacing.md * 2 - spacing.xs * (columns - 1)) / columns;
  const open = (message) => navigation.navigate('MainTabs', {
    screen: 'Photos', params: { screen: 'Messages', params: { jumpTo: message.id } },
  });

  const renderItem = ({ item }) => {
    const m = item.message;
    if (tab === 'photo') {
      return (
        <Pressable onPress={() => open(m)} style={{ width: tile, height: tile, margin: spacing.xs / 2 }}>
          <Image source={{ uri: mediaUrl(m.image_url) }} style={[styles.fill, { backgroundColor: colors.surfaceAlt }]} />
        </Pressable>
      );
    }
    if (tab === 'doodle') {
      return (
        <Pressable onPress={() => open(m)} style={[styles.doodle, { width: tile, height: tile, margin: spacing.xs / 2, backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Doodle strokeData={m.stroke_data} />
        </Pressable>
      );
    }
    const text = textOf(m);
    let title; let sub; let onPress = () => open(m);
    if (tab === 'location') {
      const place = parseBody(text);
      title = place?.label || 'Shared place';
      sub = place ? `${Number(place.lat).toFixed(4)}, ${Number(place.lng).toFixed(4)}` : 'Encrypted';
      if (place) onPress = () => Linking.openURL(mapsUrl(place, Platform.OS)).catch(() => {});
    } else if (tab === 'poll') {
      const poll = parseBody(text);
      title = poll?.question || 'Poll';
      sub = m.meta?.closed ? 'Ended' : `${(m.votes || []).length} vote${(m.votes || []).length === 1 ? '' : 's'}`;
    } else {
      title = item.url;
      sub = whenLabel(m.sent_at);
      onPress = () => Linking.openURL(item.url).catch(() => {});
    }
    return (
      <Pressable onPress={onPress} onLongPress={() => open(m)} style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Icon name={TABS.find((t) => t.key === tab).icon} chip size={18} />
        <View style={{ flex: 1 }}>
          <Text style={font.body} numberOfLines={2}>{title}</Text>
          <Text style={font.muted} numberOfLines={1}>{sub} · {whenLabel(m.sent_at)}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            style={[styles.tab, { backgroundColor: tab === t.key ? colors.accent : colors.surfaceAlt }]}
            accessibilityState={{ selected: tab === t.key }}
          >
            <Text style={{ color: tab === t.key ? '#fff' : colors.text, fontWeight: '600' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        key={`${tab}-${columns}`}
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={columns}
        renderItem={renderItem}
        contentContainerStyle={{ padding: spacing.md, width: '100%', maxWidth: 1100, alignSelf: 'center' }}
        ListEmptyComponent={<Text style={[font.muted, { textAlign: 'center', marginTop: spacing.xl }]}>Nothing shared here yet</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, padding: spacing.md, paddingBottom: 0, justifyContent: 'center' },
  tab: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  fill: { width: '100%', height: '100%', borderRadius: radius.sm },
  doodle: { borderRadius: radius.sm, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.sm },
});
