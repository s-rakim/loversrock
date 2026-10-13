import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, Image, Alert, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Polyline } from 'react-native-svg';
import { apiFetch, connectSocket, mediaUrl } from '../services/api';
import { colors, font, spacing, radius } from '../theme';
import { MorphButton } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import { useCouple } from '../components/CoupleContext';

const REACTIONS = ['❤️', '😂', '😮', '😢', '👍', '🔥'];

function preview(message) {
  if (!message) return '';
  if (message.type === 'photo') return '📷 Photo';
  if (message.type === 'doodle') return '🎨 Doodle';
  return message.content || '';
}

function Doodle({ strokeData }) {
  return (
    <Svg width={160} height={120} style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.sm }}>
      {(strokeData || []).map((stroke, i) => (
        <Polyline
          key={i}
          points={stroke.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={colors.accent}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

export default function MessagesScreen({ navigation }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);
  const { me } = useCouple();
  const [replyTo, setReplyTo] = useState(null);

  function openActions(message) {
    Alert.alert(preview(message).slice(0, 60) || 'Message', undefined, [
      { text: 'Reply', onPress: () => setReplyTo(message) },
      ...REACTIONS.map((emoji) => ({ text: emoji, onPress: () => react(message, emoji) })),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function react(message, emoji) {
    try {
      const d = await apiFetch(`/messages/${message.id}/react`, { method: 'POST', body: { emoji } });
      setMessages((prev) => prev.map((m) => (m.id === d.messageId ? { ...m, reactions: d.reactions } : m)));
    } catch (err) {
      Alert.alert('Could not react', err.message);
    }
  }

  const load = useCallback(() => {
    apiFetch('/messages').then((d) => setMessages(d.messages)).catch((err) => Alert.alert('Error', err.message));
  }, []);

  useFocusEffect(load);

  useEffect(() => {
    let socketRef;
    connectSocket().then((socket) => {
      socketRef = socket;
      socket.on('message:new', ({ message }) => setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message])));
      socket.on('message:reactions', ({ messageId, reactions }) =>
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))));
    });
    return () => { socketRef?.off('message:new'); socketRef?.off('message:reactions'); };
  }, []);

  async function sendText() {
    if (!draft.trim()) return;
    try {
      const data = await apiFetch('/messages', { method: 'POST', body: { type: 'text', content: draft.trim(), replyToMessageId: replyTo?.id } });
      setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]));
      setDraft('');
      setReplyTo(null);
    } catch (err) {
      Alert.alert('Could not send', err.message);
    }
  }

  async function sendPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.6,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    try {
      const data = await apiFetch('/messages', {
        method: 'POST',
        body: { type: 'photo', image: `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`, replyToMessageId: replyTo?.id },
      });
      setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]));
      setReplyTo(null);
    } catch (err) {
      Alert.alert('Could not send photo', err.message);
    }
  }

  return (
    <View style={styles.container}>
      <StickerField variant="minimal" />
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 100 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const mine = me && item.sender_id === me.id;
          const quoted = item.reply_to_message_id ? messages.find((m) => m.id === item.reply_to_message_id) : null;
          const counts = (item.reactions || []).reduce((acc, r) => ({ ...acc, [r.emoji]: (acc[r.emoji] || 0) + 1 }), {});
          return (
            <Pressable onLongPress={() => openActions(item)} delayLongPress={250} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
              <View style={[styles.bubble, mine && styles.bubbleMine]}>
                {quoted ? (
                  <View style={styles.quote}>
                    <Text style={font.muted} numberOfLines={2}>{preview(quoted)}</Text>
                  </View>
                ) : null}
                {item.type === 'text' && <Text style={font.body}>{item.content}</Text>}
                {item.type === 'photo' && <Image source={{ uri: mediaUrl(item.image_url) }} style={styles.photo} />}
                {item.type === 'doodle' && <Doodle strokeData={item.stroke_data} />}
              </View>
              {Object.keys(counts).length > 0 && (
                <View style={[styles.reactions, mine && { alignSelf: 'flex-end' }]}>
                  {Object.entries(counts).map(([emoji, n]) => (
                    <Pressable key={emoji} onPress={() => react(item, emoji)} style={styles.reaction}>
                      <Text>{emoji}{n > 1 ? ` ${n}` : ''}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyRow}>
            <Icon name="chatbubble-outline" chip chipSize={40} />
            <Text style={font.muted}>Say something</Text>
          </View>
        }
      />

      {replyTo && (
        <View style={styles.replyBar}>
          <Icon name="return-down-forward" chip={false} size={16} />
          <Text style={[font.muted, { flex: 1 }]} numberOfLines={1}>Replying to: {preview(replyTo)}</Text>
          <Icon name="close" chip={false} size={16} color={colors.textMuted} onPress={() => setReplyTo(null)} />
        </View>
      )}
      <View style={styles.inputBar}>
        <Icon name="brush-outline" chip chipColor={colors.surfaceAlt} onPress={() => navigation.navigate('Canvas')} />
        <Icon name="image-outline" chip chipColor={colors.surfaceAlt} onPress={sendPhoto} />
        <TextInput
          placeholder="Message…"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          style={styles.input}
          onSubmitEditing={sendText}
        />
        <MorphButton onPress={sendText} style={styles.sendButton}>
          <Icon name="send" chip={false} color="#fff" size={18} />
        </MorphButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  bubble: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border, maxWidth: '80%' },
  photo: { width: 180, height: 180, borderRadius: radius.sm },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, marginBottom: 90 },
  input: { flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border },
  sendButton: { backgroundColor: colors.accent, borderRadius: radius.icon, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  emptyRow: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: colors.accentSoft, borderColor: colors.accentSoft },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: spacing.sm, marginBottom: spacing.xs },
  reactions: { flexDirection: 'row', gap: 4, marginTop: -6, marginLeft: spacing.sm },
  reaction: { backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: colors.border },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
});
