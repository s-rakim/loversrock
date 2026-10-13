// Lovers X-style joint feed: post a moment (text, photo or both); like, love
// and comment on each other's posts. Everything updates live.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, Image, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { apiFetch, connectSocket, mediaUrl } from '../services/api';
import { useCouple } from '../components/CoupleContext';
import { Button, Card, Empty, ui } from '../components/ui';
import { MorphButton, FadeInUp } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import { useI18n } from '../i18n';
import { colors, font, spacing, radius } from '../theme';

function timeAgo(iso, t) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t('time.now');
  if (mins < 60) return t('time.minutes', { n: mins });
  if (mins < 1440) return t('time.hours', { n: Math.round(mins / 60) });
  return new Date(iso).toLocaleDateString();
}

function Post({ post, meId, onChange, onDelete, navigation }) {
  const { t } = useI18n();
  const [comment, setComment] = useState('');
  const [showComments, setShowComments] = useState(false);

  async function react(kind) {
    try {
      const d = await apiFetch(`/feed/${post.id}/react`, { method: 'POST', body: { kind } });
      onChange(d.post);
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }
  async function sendComment() {
    if (!comment.trim()) return;
    try {
      const d = await apiFetch(`/feed/${post.id}/comments`, { method: 'POST', body: { body: comment.trim() } });
      onChange({ ...post, comments: [...post.comments, d.comment] });
      setComment('');
      setShowComments(true);
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <MorphButton onPress={() => navigation.navigate('Profile', { who: post.author_id === meId ? 'me' : 'partner' })} style={styles.postHeader}>
        {post.author_avatar ? <Image source={{ uri: mediaUrl(post.author_avatar) }} style={styles.authorPhoto} /> : <Icon name="person" chip chipSize={32} size={16} />}
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '700', color: colors.text }}>{post.author_id === meId ? t('common.you') : post.author_name}</Text>
          <Text style={font.muted}>{timeAgo(post.created_at, t)}</Text>
        </View>
        {post.author_id === meId && <Icon name="trash-outline" size={16} color={colors.textMuted} onPress={() => onDelete(post)} />}
      </MorphButton>
      {post.image_url ? <Image source={{ uri: mediaUrl(post.image_url) }} style={styles.postImage} /> : null}
      {post.body ? <Text style={[font.body, { paddingHorizontal: spacing.md, paddingTop: spacing.sm }]}>{post.body}</Text> : null}
      <View style={styles.actions}>
        <MorphButton onPress={() => react('like')} style={styles.action}>
          <Icon name={post.likedByMe ? 'thumbs-up' : 'thumbs-up-outline'} size={18} chip={false} color={post.likedByMe ? colors.accent : colors.textMuted} />
          <Text style={styles.count}>{post.likes}</Text>
        </MorphButton>
        <MorphButton onPress={() => react('love')} style={styles.action}>
          <Icon name={post.lovedByMe ? 'heart' : 'heart-outline'} size={18} chip={false} color={post.lovedByMe ? colors.accent : colors.textMuted} />
          <Text style={styles.count}>{post.loves}</Text>
        </MorphButton>
        <MorphButton onPress={() => setShowComments((s) => !s)} style={styles.action}>
          <Icon name="chatbubble-outline" size={18} chip={false} color={colors.textMuted} />
          <Text style={styles.count}>{post.comments.length}</Text>
        </MorphButton>
      </View>
      {showComments && post.comments.map((c) => (
        <View key={c.id} style={styles.comment}>
          <Text style={{ fontWeight: '700', color: colors.text }}>{c.author_id === meId ? t('common.you') : c.author_name} </Text>
          <Text style={[font.body, { flex: 1 }]}>{c.body}</Text>
        </View>
      ))}
      <View style={styles.commentBar}>
        <TextInput value={comment} onChangeText={setComment} placeholder={t('feed.comment')} placeholderTextColor={colors.textMuted}
          style={[ui.input, { flex: 1, paddingVertical: 6 }]} onSubmitEditing={sendComment} />
        <Icon name="send" size={16} onPress={sendComment} />
      </View>
    </Card>
  );
}

export default function FeedScreen({ navigation }) {
  const { t } = useI18n();
  const { me } = useCouple();
  const [posts, setPosts] = useState([]);
  const [draft, setDraft] = useState('');
  const [image, setImage] = useState(null);
  const [posting, setPosting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => apiFetch('/feed').then((d) => setPosts(d.posts)).catch((err) => Alert.alert(t('common.error'), err.message)), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    let socket;
    const reload = () => load();
    const onDeleted = ({ postId }) => setPosts((prev) => prev.filter((p) => p.id !== postId));
    connectSocket().then((s) => {
      socket = s;
      s.on('feed:new', reload);
      s.on('feed:updated', reload);
      s.on('feed:deleted', onDeleted);
    }).catch(() => {});
    return () => { socket?.off('feed:new', reload); socket?.off('feed:updated', reload); socket?.off('feed:deleted', onDeleted); };
  }, [load]);

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.6 });
    if (!result.canceled) setImage(result.assets[0]);
  }

  async function post() {
    if (!draft.trim() && !image) return;
    setPosting(true);
    try {
      const body = { body: draft.trim() || undefined };
      if (image) body.image = `data:${image.mimeType || 'image/jpeg'};base64,${image.base64}`;
      const d = await apiFetch('/feed', { method: 'POST', body });
      setPosts((prev) => [d.post, ...prev.filter((p) => p.id !== d.post.id)]);
      setDraft('');
      setImage(null);
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    } finally {
      setPosting(false);
    }
  }

  function remove(p) {
    Alert.alert(t('feed.deleteTitle'), '', [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: async () => {
        await apiFetch(`/feed/${p.id}`, { method: 'DELETE' }).catch((err) => Alert.alert(t('common.error'), err.message));
        setPosts((prev) => prev.filter((x) => x.id !== p.id));
      } },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StickerField variant="minimal" />
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListHeaderComponent={
          <FadeInUp>
            <Text style={[font.h1, { marginBottom: spacing.md }]}>{t('feed.title')}</Text>
            <Card>
              <TextInput value={draft} onChangeText={setDraft} placeholder={t('feed.placeholder')} placeholderTextColor={colors.textMuted}
                style={[ui.input, { minHeight: 56 }]} multiline />
              {image ? <Image source={{ uri: image.uri }} style={styles.preview} /> : null}
              <View style={[ui.row, { marginTop: spacing.sm }]}>
                <Button small kind="secondary" icon={image ? 'close' : 'image-outline'} title={image ? t('feed.removePhoto') : t('feed.addPhoto')} onPress={image ? () => setImage(null) : pickImage} />
                <View style={{ flex: 1 }} />
                <Button small icon="paper-plane" title={posting ? t('common.saving') : t('feed.post')} onPress={post} disabled={posting} />
              </View>
            </Card>
          </FadeInUp>
        }
        renderItem={({ item }) => (
          <Post post={item} meId={me?.id} navigation={navigation}
            onChange={(next) => setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)))} onDelete={remove} />
        )}
        ListEmptyComponent={<Empty icon="newspaper-outline" text={t('feed.empty')} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  authorPhoto: { width: 32, height: 32, borderRadius: 16 },
  postImage: { width: '100%', aspectRatio: 1 },
  actions: { flexDirection: 'row', gap: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  count: { color: colors.textMuted, fontWeight: '600' },
  comment: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  commentBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, paddingTop: spacing.xs },
  preview: { width: '100%', height: 180, borderRadius: radius.md, marginTop: spacing.sm },
});
