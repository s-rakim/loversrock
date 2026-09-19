import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, Image, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Polyline } from 'react-native-svg';
import { apiFetch, connectSocket, mediaUrl } from '../services/api';
import { spacing, radius } from '../theme';
import { MorphButton } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import { useTheme } from '../components/ThemeContext';

function Doodle({ strokeData }) {
  const { colors } = useTheme();
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
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);

  const load = useCallback(() => {
    apiFetch('/messages').then((d) => setMessages(d.messages)).catch((err) => Alert.alert('Error', err.message));
  }, []);

  useFocusEffect(load);

  useEffect(() => {
    let socketRef;
    connectSocket().then((socket) => {
      socketRef = socket;
      socket.on('message:new', ({ message }) => setMessages((prev) => [...prev, message]));
    });
    return () => socketRef?.off('message:new');
  }, []);

  async function sendText() {
    if (!draft.trim()) return;
    try {
      const data = await apiFetch('/messages', { method: 'POST', body: { type: 'text', content: draft.trim() } });
      setMessages((prev) => [...prev, data.message]);
      setDraft('');
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
        body: { type: 'photo', image: `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}` },
      });
      setMessages((prev) => [...prev, data.message]);
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
        renderItem={({ item }) => (
          <View style={styles.bubble}>
            {item.type === 'text' && <Text style={font.body}>{item.content}</Text>}
            {item.type === 'photo' && <Image source={{ uri: mediaUrl(item.image_url) }} style={styles.photo} />}
            {item.type === 'doodle' && <Doodle strokeData={item.stroke_data} />}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyRow}>
            <Icon name="chatbubble-outline" chip chipSize={40} />
            <Text style={font.muted}>Say something</Text>
          </View>
        }
      />

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

const makeStyles = (colors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  bubble: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border, maxWidth: '80%' },
  photo: { width: 180, height: 180, borderRadius: radius.sm },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, marginBottom: 90 },
  input: { flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border },
  sendButton: { backgroundColor: colors.accent, borderRadius: radius.icon, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  emptyRow: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
});
