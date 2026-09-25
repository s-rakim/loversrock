// Partner profiles (Lovers X). Shows either person: their character in their
// current mood, bio, love language, favourites, and their posts. Your own
// profile is editable and links to the Wardrobe and mood picker.
import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Image, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { apiFetch, mediaUrl } from '../services/api';
import { useCouple, characterFor } from '../components/CoupleContext';
import Mascot, { EMOTION_LABELS } from '../components/Mascot';
import MoodPicker from '../components/MoodPicker';
import { Button, Card, Chip, Screen, SectionTitle, Empty, ui } from '../components/ui';
import { useI18n } from '../i18n';
import { colors, font, spacing, radius } from '../theme';

const LOVE_LANGUAGES = ['words', 'quality_time', 'gifts', 'acts', 'touch'];
const FAVORITE_KEYS = ['food', 'movie', 'song', 'place', 'colour'];

export default function ProfileScreen({ route, navigation }) {
  const { t } = useI18n();
  const who = route.params?.who || 'me';
  const { me, partner, pair, refresh } = useCouple();
  const person = who === 'me' ? me : partner;
  const character = characterFor(person);
  const [posts, setPosts] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [moodOpen, setMoodOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    navigation.setOptions({ title: who === 'me' ? t('profile.mine') : person?.name || t('profile.partner') });
    refresh();
    if (person?.id) apiFetch(`/feed/by/${person.id}`).then((d) => setPosts(d.posts)).catch(() => {});
  }, [person?.id, who]));

  function startEdit() {
    setDraft({
      bio: person?.bio || '',
      birthday: person?.birthday || '',
      loveLanguage: person?.loveLanguage || null,
      favorites: { ...(person?.favorites || {}) },
    });
    setEditing(true);
  }

  async function save() {
    try {
      await apiFetch('/profile', {
        method: 'PATCH',
        body: { bio: draft.bio || null, birthday: draft.birthday || null, loveLanguage: draft.loveLanguage, favorites: draft.favorites },
      });
      await refresh();
      setEditing(false);
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }

  async function changePhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.5, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled) return;
    const asset = result.assets[0];
    try {
      await apiFetch('/profile/avatar', { method: 'POST', body: { image: `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}` } });
      await refresh();
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }

  if (!person) return <Screen><Empty icon="person-outline" text={t('profile.notPaired')} /></Screen>;

  return (
    <Screen sticker="home">
      <View style={styles.hero}>
        <Mascot avatar={person.avatar} emotion={character.emotion} context="hero" onLongPress={who === 'me' ? () => setMoodOpen(true) : undefined} />
        <View style={styles.nameRow}>
          {person.avatarUrl ? <Image source={{ uri: mediaUrl(person.avatarUrl) }} style={styles.photo} /> : null}
          <Text style={font.h1}>{person.name}</Text>
        </View>
        <Text style={font.muted}>
          {person.mood ? t('profile.feeling', { mood: `${person.mood.emoji} ${person.mood.text || t(`emotion.${character.emotion}`) || EMOTION_LABELS[character.emotion]}` }) : t('profile.noMood')}
        </Text>
        {pair && <Text style={[font.muted, { marginTop: 2 }]}>{t('profile.daysTogether', { n: pair.daysTogether })}</Text>}
      </View>

      {who === 'me' && (
        <View style={[ui.row, { justifyContent: 'center', marginBottom: spacing.md }]}>
          <Button small icon="happy-outline" title={t('mood.set')} onPress={() => setMoodOpen(true)} />
          <Button small kind="secondary" icon="shirt-outline" title={t('wardrobe.title')} onPress={() => navigation.navigate('Wardrobe')} />
          <Button small kind="secondary" icon="camera-outline" title={t('profile.photo')} onPress={changePhoto} />
        </View>
      )}

      <Card>
        {editing ? (
          <>
            <Text style={styles.label}>{t('profile.bio')}</Text>
            <TextInput style={[ui.input, { minHeight: 60 }]} multiline value={draft.bio} onChangeText={(v) => setDraft((d) => ({ ...d, bio: v }))} />
            <Text style={styles.label}>{t('profile.birthday')}</Text>
            <TextInput style={ui.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} value={draft.birthday} onChangeText={(v) => setDraft((d) => ({ ...d, birthday: v }))} />
            <Text style={styles.label}>{t('profile.loveLanguage')}</Text>
            <View style={ui.wrap}>
              {LOVE_LANGUAGES.map((l) => <Chip key={l} label={t(`loveLanguage.${l}`)} active={draft.loveLanguage === l} onPress={() => setDraft((d) => ({ ...d, loveLanguage: l }))} />)}
            </View>
            <Text style={styles.label}>{t('profile.favorites')}</Text>
            {FAVORITE_KEYS.map((k) => (
              <TextInput key={k} style={[ui.input, { marginBottom: spacing.xs }]} placeholder={t(`favorite.${k}`)} placeholderTextColor={colors.textMuted}
                value={draft.favorites[k] || ''} onChangeText={(v) => setDraft((d) => ({ ...d, favorites: { ...d.favorites, [k]: v } }))} />
            ))}
            <View style={[ui.row, { marginTop: spacing.md }]}>
              <Button kind="secondary" title={t('common.cancel')} onPress={() => setEditing(false)} style={{ flex: 1 }} />
              <Button title={t('common.save')} onPress={save} style={{ flex: 1 }} />
            </View>
          </>
        ) : (
          <>
            <Text style={font.body}>{person.bio || t('profile.noBio')}</Text>
            <View style={styles.facts}>
              {person.birthday ? <Text style={styles.fact}>🎂 {person.birthday}</Text> : null}
              {person.loveLanguage ? <Text style={styles.fact}>💞 {t(`loveLanguage.${person.loveLanguage}`)}</Text> : null}
              {Object.entries(person.favorites || {}).filter(([, v]) => v).map(([k, v]) => (
                <Text key={k} style={styles.fact}>{t(`favorite.${k}`)}: {v}</Text>
              ))}
            </View>
            {who === 'me' && <Button small kind="secondary" icon="create-outline" title={t('common.edit')} onPress={startEdit} style={{ alignSelf: 'flex-start', marginTop: spacing.sm }} />}
          </>
        )}
      </Card>

      <SectionTitle>{t('profile.posts')}</SectionTitle>
      {posts.length === 0 ? <Empty icon="newspaper-outline" text={t('feed.empty')} /> : (
        <View style={styles.grid}>
          {posts.map((p) => (
            <Card key={p.id} style={styles.tile} onPress={() => navigation.navigate('MainTabs', { screen: 'Feed' })}>
              {p.image_url ? <Image source={{ uri: mediaUrl(p.image_url) }} style={styles.tileImage} /> : null}
              {p.body ? <Text numberOfLines={3} style={font.muted}>{p.body}</Text> : null}
            </Card>
          ))}
        </View>
      )}
      <MoodPicker visible={moodOpen} onClose={() => setMoodOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginBottom: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  photo: { width: 34, height: 34, borderRadius: 17 },
  label: { ...font.muted, marginTop: spacing.md, marginBottom: spacing.xs },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  fact: { ...font.muted, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: '48%', padding: spacing.sm },
  tileImage: { width: '100%', aspectRatio: 1, borderRadius: radius.sm, marginBottom: spacing.xs },
});
