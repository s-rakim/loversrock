// One message in the thread: its body (text, photo, drawing, poll, place,
// or "Message deleted"), the message it replies to, its reactions, and the
// small print (edited, scheduled, seen, time).
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Image, Pressable, Linking, Platform } from 'react-native';
import { spacing, radius } from '../../theme';
import { useTheme } from '../ThemeContext';
import Icon from '../Icon';
import Doodle from '../Doodle';
import { mediaUrl } from '../../services/api';
import PollCard from './PollCard';
import {
  isDeleted, isScheduled, parseBody, previewOf, splitLinks, whenLabel, mapsUrl,
} from './chatModel';

const timeOf = (message) => {
  const date = new Date(message.sent_at);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

/** Reactions under a bubble, one chip per emoji, yours highlighted. */
function Reactions({ reactions, meId, onToggle, mine }) {
  const { colors } = useTheme();
  const groups = useMemo(() => {
    const by = new Map();
    for (const r of reactions || []) {
      const g = by.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false };
      g.count += 1;
      if (r.userId === meId) g.mine = true;
      by.set(r.emoji, g);
    }
    return [...by.values()];
  }, [reactions, meId]);
  if (!groups.length) return null;
  return (
    <View style={[styles.reactions, mine ? { justifyContent: 'flex-end' } : null]}>
      {groups.map((g) => (
        <Pressable
          key={g.emoji}
          onPress={() => onToggle(g.mine ? null : g.emoji)}
          style={[styles.reaction, { backgroundColor: colors.surface, borderColor: g.mine ? colors.accent : colors.border }]}
          accessibilityLabel={`${g.emoji} ${g.count}`}
        >
          <Text style={styles.reactionEmoji}>{g.emoji}</Text>
          {g.count > 1 ? <Text style={[styles.reactionCount, { color: colors.textMuted }]}>{g.count}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

export default function MessageBubble({
  message, text, mine, meId, replyTo, replyText, seen, highlighted, partnerName,
  onLongPress, onPressReply, onVote, onReact,
}) {
  const { colors, font } = useTheme();
  const ink = mine ? '#fff' : colors.text;
  const soft = mine ? 'rgba(255,255,255,0.78)' : colors.textMuted;

  const body = (() => {
    if (isDeleted(message)) {
      return <Text style={[font.muted, styles.deleted, mine && { color: soft }]}>Message deleted</Text>;
    }
    switch (message.type) {
      case 'photo':
        return <Image source={{ uri: mediaUrl(message.image_url) }} style={[styles.photo, { backgroundColor: colors.surfaceAlt }]} resizeMode="cover" />;
      case 'doodle':
        return <View style={styles.doodleFrame}><Doodle strokeData={message.stroke_data} /></View>;
      case 'poll':
        return (
          <PollCard
            message={message}
            poll={parseBody(text)}
            sealed={text === null}
            meId={meId}
            mine={mine}
            onVote={onVote}
          />
        );
      case 'location': {
        const place = parseBody(text);
        if (!place) return <Text style={[font.muted, mine && { color: soft }]}>{text === undefined ? 'Decrypting…' : 'A place'}</Text>;
        return (
          <Pressable
            onPress={() => Linking.openURL(mapsUrl(place, Platform.OS)).catch(() => {})}
            style={[styles.place, { backgroundColor: mine ? 'rgba(255,255,255,0.16)' : colors.surfaceAlt }]}
            accessibilityLabel={`Open ${place.label || 'this place'} in maps`}
          >
            <Icon name="location" chip={false} size={22} color={mine ? '#fff' : colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[font.body, { color: ink, fontWeight: '600' }]} numberOfLines={1}>{place.label || 'Shared place'}</Text>
              <Text style={{ color: soft, fontSize: 12 }}>
                {Number(place.lat).toFixed(4)}, {Number(place.lng).toFixed(4)} · Open in Maps
              </Text>
            </View>
          </Pressable>
        );
      }
      default: {
        if (text === undefined) return <Text style={[font.muted, mine && { color: soft }]}>Decrypting…</Text>;
        if (text === null) {
          // Usually the other phone was reinstalled and has new keys.
          return <Text style={[font.muted, mine && { color: soft }]}>Can&apos;t open this message — the keys don&apos;t match.</Text>;
        }
        return (
          <Text style={[font.body, { color: ink }]}>
            {splitLinks(text).map((part, i) => (part.url ? (
              <Text
                key={i}
                style={{ textDecorationLine: 'underline', color: mine ? '#fff' : colors.accent }}
                onPress={() => Linking.openURL(part.url).catch(() => {})}
              >
                {part.text}
              </Text>
            ) : part.text))}
          </Text>
        );
      }
    }
  })();

  return (
    <View style={[styles.wrap, mine ? styles.wrapMine : styles.wrapTheirs]}>
      <Pressable
        onLongPress={() => onLongPress(message)}
        delayLongPress={280}
        style={[
          styles.bubble,
          mine
            ? { backgroundColor: colors.accent, borderBottomRightRadius: radius.sm }
            : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: radius.sm },
          isScheduled(message) && { opacity: 0.7, borderStyle: 'dashed', borderWidth: 1, borderColor: mine ? '#fff' : colors.border },
          highlighted && { borderWidth: 2, borderColor: colors.gold || '#f5b301' },
          message.type === 'poll' && !isDeleted(message) && styles.wide,
        ]}
        accessibilityHint="Hold for reactions, reply, edit and more"
      >
        {message.reply_to_message_id ? (
          <Pressable
            onPress={() => onPressReply(message.reply_to_message_id)}
            style={[styles.quote, { borderLeftColor: mine ? '#fff' : colors.accent, backgroundColor: mine ? 'rgba(255,255,255,0.14)' : colors.surfaceAlt }]}
          >
            <Text style={{ color: mine ? '#fff' : colors.accent, fontSize: 12, fontWeight: '700' }}>
              {replyTo ? (replyTo.sender_id === meId ? 'You' : partnerName || 'Them') : 'Reply'}
            </Text>
            <Text style={{ color: soft, fontSize: 13 }} numberOfLines={2}>{previewOf(replyTo, replyText)}</Text>
          </Pressable>
        ) : null}
        {body}
        <View style={styles.meta}>
          {message.silent ? <Icon name="notifications-off-outline" chip={false} size={11} color={soft} /> : null}
          {message.pinned_at && !isDeleted(message) ? <Icon name="pin" chip={false} size={11} color={soft} /> : null}
          {message.edited_at && !isDeleted(message) ? <Text style={[styles.metaText, { color: soft }]}>edited</Text> : null}
          {isScheduled(message) ? (
            <>
              <Icon name="time-outline" chip={false} size={11} color={soft} />
              <Text style={[styles.metaText, { color: soft }]}>{whenLabel(message.scheduled_for)}</Text>
            </>
          ) : (
            <Text style={[styles.metaText, { color: soft }]}>{timeOf(message)}</Text>
          )}
          {mine && !isScheduled(message) ? (
            <Icon name={message.seen_at ? 'checkmark-done' : 'checkmark'} chip={false} size={13} color={soft} />
          ) : null}
        </View>
      </Pressable>
      <Reactions reactions={message.reactions} meId={meId} mine={mine} onToggle={(emoji) => onReact(message, emoji)} />
      {seen ? <Text style={[styles.seen, { color: colors.textMuted }]}>Seen</Text> : null}
      {message.reminder ? (
        <Text style={[styles.seen, { color: colors.textMuted }]}>Reminder {whenLabel(message.reminder)}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.xs, maxWidth: '82%' },
  wrapMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  wrapTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minWidth: 72 },
  wide: { minWidth: 240 },
  deleted: { fontStyle: 'italic' },
  photo: { width: 220, height: 220, borderRadius: radius.sm },
  doodleFrame: { width: 220, height: 165 },
  place: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.sm, minWidth: 220 },
  quote: { borderLeftWidth: 3, borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 4, marginBottom: spacing.xs },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2 },
  metaText: { fontSize: 10 },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: -6, paddingHorizontal: spacing.xs },
  reaction: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1 },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { fontSize: 11, marginLeft: 2 },
  seen: { fontSize: 11, marginTop: 2, marginHorizontal: spacing.xs },
});
