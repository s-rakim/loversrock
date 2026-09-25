import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, Image, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { apiFetch, mediaUrl } from '../services/api';
import { colors, font, spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';

export default function MemoriesScreen({ navigation }) {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState('');

  const load = useCallback(() => {
    apiFetch('/memories')
      .then((data) => setMemories(data.memories))
      .catch((err) => Alert.alert('Could not load memories', err.message))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  async function addMemory() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Photo library access is required to add a memory.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.6, // compress before upload
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    const mimeType = asset.mimeType || 'image/jpeg';

    setUploading(true);
    try {
      const data = await apiFetch('/memories', {
        method: 'POST',
        body: { image: `data:${mimeType};base64,${asset.base64}`, caption: caption.trim() || undefined },
      });
      setMemories((prev) => [data.memory, ...prev]);
      setCaption('');
    } catch (err) {
      Alert.alert('Upload failed', err.message);
    } finally {
      setUploading(false);
    }
  }

  async function removeMemory(id) {
    try {
      await apiFetch(`/memories/${id}`, { method: 'PATCH', body: { deleted: true } });
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      Alert.alert('Could not delete', err.message);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StickerField variant="minimal" />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}>
        <Text style={font.h1}>Memories</Text>
        <MorphButton onPress={() => navigation.navigate('Timeline')} style={styles.timelineButton}>
          <Icon name="calendar-number-outline" chip={false} size={16} />
          <Text style={{ color: colors.accent, fontWeight: '700' }}>Calendar</Text>
        </MorphButton>
      </View>
      <TextInput
        value={caption}
        onChangeText={setCaption}
        placeholder="Caption for your next memory (optional)"
        placeholderTextColor={colors.textMuted}
        style={styles.captionInput}
        maxLength={140}
      />
      <MorphButton onPress={addMemory} disabled={uploading} style={styles.addButton}>
        <Icon name="add-circle-outline" chip={false} color="#fff" size={18} />
        <Text style={styles.addButtonText}>{uploading ? 'Uploading…' : 'Add memory'}</Text>
      </MorphButton>

      <FlatList
        data={memories}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.sm }}
        contentContainerStyle={{ gap: spacing.sm, paddingBottom: 140 }}
        renderItem={({ item, index }) => (
          <FadeInUp delay={index * 30} style={{ flex: 1 }}>
            <MorphButton onPress={() => removeMemory(item.id)} style={styles.tile}>
              <Image source={{ uri: mediaUrl(item.image_url) }} style={styles.image} />
              {item.caption ? <Text style={styles.caption} numberOfLines={1}>{item.caption}</Text> : null}
            </MorphButton>
          </FadeInUp>
        )}
        ListEmptyComponent={
          <View style={styles.emptyRow}>
            <Icon name="images-outline" chip chipSize={40} />
            <Text style={font.muted}>No memories yet — add your first one.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  addButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: spacing.sm, marginBottom: spacing.md,
  },
  addButtonText: { color: '#fff', fontWeight: '700' },
  tile: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  image: { width: '100%', aspectRatio: 1 },
  caption: { ...font.muted, padding: spacing.xs },
  emptyRow: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  timelineButton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accentSoft, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  captionInput: { backgroundColor: colors.surface, color: colors.text, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
});
