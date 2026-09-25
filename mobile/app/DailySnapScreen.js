// Daily Snap: a quick photo + caption for your partner. Their latest snap is
// front and centre (and on the Daily Snap widget); history lives below.
import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Image, Alert, Dimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { apiFetch, mediaUrl } from '../services/api';
import { useCouple } from '../components/CoupleContext';
import { Button, Card, Screen, SectionTitle, Empty, ui } from '../components/ui';
import { MorphButton } from '../components/Motion';
import CelebrationBurst from '../components/Celebration';
import { refreshWidgets } from '../services/widgetBridge';
import { useI18n } from '../i18n';
import { colors, font, spacing, radius } from '../theme';

const THUMB = (Dimensions.get('window').width - spacing.lg * 2 - spacing.sm * 2) / 3;

export default function DailySnapScreen() {
  const { t } = useI18n();
  const { me, partner } = useCouple();
  const [snaps, setSnaps] = useState([]);
  const [pending, setPending] = useState(null);
  const [caption, setCaption] = useState('');
  const [sending, setSending] = useState(false);
  const [burst, setBurst] = useState(0);

  const load = useCallback(() => apiFetch('/widget-photos').then((d) => {
    setSnaps(d.snaps);
    const latestFromPartner = d.snaps.find((s) => s.sender_id !== me?.id);
    if (latestFromPartner && !latestFromPartner.seen_at) apiFetch(`/widget-photos/${latestFromPartner.id}/seen`, { method: 'PATCH' }).catch(() => {});
  }).catch((err) => Alert.alert(t('common.error'), err.message)), [me?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function capture(fromCamera) {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const opts = { mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.6 };
    const result = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!result.canceled) setPending(result.assets[0]);
  }

  async function send() {
    setSending(true);
    try {
      await apiFetch('/widget-photos', { method: 'POST', body: { image: `data:${pending.mimeType || 'image/jpeg'};base64,${pending.base64}`, caption: caption.trim() || undefined } });
      setPending(null);
      setCaption('');
      setBurst((b) => b + 1);
      refreshWidgets();
      load();
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    } finally {
      setSending(false);
    }
  }

  const theirs = snaps.find((s) => s.sender_id !== me?.id);

  return (
    <Screen sticker="celebrate">
      {pending ? (
        <Card>
          <Image source={{ uri: pending.uri }} style={styles.big} />
          <TextInput value={caption} onChangeText={setCaption} placeholder={t('snap.caption')} placeholderTextColor={colors.textMuted}
            style={[ui.input, { marginTop: spacing.md }]} maxLength={120} />
          <View style={[ui.row, { marginTop: spacing.md }]}>
            <Button kind="secondary" title={t('common.cancel')} onPress={() => setPending(null)} style={{ flex: 1 }} />
            <Button title={sending ? t('common.saving') : t('snap.send', { name: partner?.name || '' })} icon="heart" onPress={send} disabled={sending} style={{ flex: 2 }} />
          </View>
        </Card>
      ) : (
        <>
          <SectionTitle>{t('snap.fromPartner', { name: partner?.name || t('profile.partner') })}</SectionTitle>
          {theirs ? (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <Image source={{ uri: mediaUrl(theirs.image_url) }} style={styles.big} />
              <View style={{ padding: spacing.md }}>
                {theirs.caption ? <Text style={font.h2}>{theirs.caption}</Text> : null}
                <Text style={font.muted}>{new Date(theirs.created_at).toLocaleString()}</Text>
              </View>
            </Card>
          ) : <Empty icon="camera-outline" text={t('snap.none', { name: partner?.name || '' })} />}
          <View style={[ui.row, { marginVertical: spacing.md }]}>
            <Button title={t('snap.take')} icon="camera" onPress={() => capture(true)} style={{ flex: 1 }} />
            <Button kind="secondary" title={t('snap.library')} icon="image-outline" onPress={() => capture(false)} style={{ flex: 1 }} />
          </View>
          <CelebrationBurst trigger={burst} />
        </>
      )}
      <SectionTitle>{t('snap.history')}</SectionTitle>
      <View style={[ui.wrap]}>
        {snaps.map((s) => (
          <MorphButton key={s.id} onPress={() => Alert.alert(s.caption || t('snap.title'), `${s.sender_name} · ${new Date(s.created_at).toLocaleString()}`)}>
            <Image source={{ uri: mediaUrl(s.image_url) }} style={[styles.thumb, s.sender_id === me?.id && { borderColor: colors.accentSoft }]} />
          </MorphButton>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  big: { width: '100%', aspectRatio: 3 / 4, borderRadius: radius.md },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border },
});
