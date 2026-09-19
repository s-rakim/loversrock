import React, { useCallback, useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, Image, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { apiFetch, mediaUrl } from '../services/api';
import { spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import { useTheme } from '../components/ThemeContext';

export default function MemoriesScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors, font), [colors, font]);
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

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
        body: { image: `data:${mimeType};base64,${asset.base64}` },
      });
      setMemories((prev) => [data.memory, ...prev]);
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
      <Text style={[font.h1, { marginBottom: spacing.md }]}>Memories</Text>
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

const makeStyles = (colors, font) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', padding: spacing.lg },
  centered: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  addButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: spacing.sm, marginBottom: spacing.md,
  },
  addButtonText: { color: '#fff', fontWeight: '700' },
  tile: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  image: { width: '100%', aspectRatio: 1 },
  caption: { ...font.muted, padding: spacing.xs },
  emptyRow: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
});
