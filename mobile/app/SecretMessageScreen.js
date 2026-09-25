// Secret messages. The widget only says "You have a message ❤️"; opening it
// here plays a little envelope animation and reveals the words.
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Animated, Easing } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { useCouple } from '../components/CoupleContext';
import { Button, Card, Screen, SectionTitle, Empty, ui } from '../components/ui';
import { MorphButton } from '../components/Motion';
import { HeartShape } from '../components/Stickers';
import CelebrationBurst from '../components/Celebration';
import { refreshWidgets } from '../services/widgetBridge';
import { useI18n } from '../i18n';
import { colors, font, spacing, radius } from '../theme';

function Envelope({ secret, onOpen }) {
  const { t } = useI18n();
  const flip = useRef(new Animated.Value(secret.opened_at ? 1 : 0)).current;
  const [burst, setBurst] = useState(0);
  const [body, setBody] = useState(secret.body);

  async function open() {
    if (body) return;
    try {
      const { secret: opened } = await onOpen(secret);
      setBody(opened.body);
      setBurst((b) => b + 1);
      Animated.timing(flip, { toValue: 1, duration: 700, easing: Easing.out(Easing.back(1.5)), useNativeDriver: true }).start();
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }

  const sealScale = flip.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.2, 0] });
  const letterY = flip.interpolate({ inputRange: [0, 1], outputRange: [30, 0] });

  return (
    <MorphButton onPress={open} style={styles.envelope}>
      {body ? (
        <Animated.View style={{ transform: [{ translateY: letterY }], opacity: flip }}>
          <Text style={styles.letter}>{body}</Text>
          <Text style={[font.muted, { marginTop: spacing.sm }]}>{new Date(secret.created_at).toLocaleString()}</Text>
        </Animated.View>
      ) : (
        <View style={{ alignItems: 'center' }}>
          <Animated.View style={{ transform: [{ scale: sealScale }] }}><HeartShape size={46} /></Animated.View>
          <Text style={[font.h2, { marginTop: spacing.sm }]}>{t('secret.tapToOpen')}</Text>
        </View>
      )}
      <CelebrationBurst trigger={burst} />
    </MorphButton>
  );
}

export default function SecretMessageScreen() {
  const { t } = useI18n();
  const { partner } = useCouple();
  const [data, setData] = useState({ inbox: [], sent: [] });
  const [draft, setDraft] = useState('');

  const load = useCallback(() => apiFetch('/secrets').then(setData).catch((err) => Alert.alert(t('common.error'), err.message)), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function send() {
    if (!draft.trim()) return;
    try {
      await apiFetch('/secrets', { method: 'POST', body: { body: draft.trim() } });
      setDraft('');
      load();
      Alert.alert(t('secret.sentTitle'), t('secret.sentBody', { name: partner?.name || '' }));
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }

  const open = async (s) => {
    const r = await apiFetch(`/secrets/${s.id}/open`, { method: 'POST' });
    refreshWidgets();
    return r;
  };

  return (
    <Screen sticker="celebrate">
      <SectionTitle>{t('secret.inbox')}</SectionTitle>
      {data.inbox.length === 0 ? <Empty icon="mail-outline" text={t('secret.empty')} /> : data.inbox.map((s) => <Envelope key={s.id} secret={s} onOpen={open} />)}
      <SectionTitle>{t('secret.write', { name: partner?.name || '' })}</SectionTitle>
      <Card>
        <TextInput value={draft} onChangeText={setDraft} multiline placeholder={t('secret.placeholder')} placeholderTextColor={colors.textMuted}
          style={[ui.input, { minHeight: 90, textAlignVertical: 'top' }]} maxLength={1000} />
        <Text style={[font.muted, { marginVertical: spacing.sm }]}>{t('secret.privacy')}</Text>
        <Button title={t('secret.send')} icon="lock-closed" onPress={send} />
      </Card>
      {data.sent.length > 0 && (
        <>
          <SectionTitle>{t('secret.sent')}</SectionTitle>
          {data.sent.map((s) => (
            <Card key={s.id} style={ui.row}>
              <Text style={[font.body, { flex: 1 }]} numberOfLines={2}>{s.body}</Text>
              <Text style={font.muted}>{s.opened_at ? t('secret.opened') : t('secret.unopened')}</Text>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  envelope: {
    backgroundColor: '#FFF6F0', borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md, minHeight: 150,
    justifyContent: 'center', borderWidth: 2, borderColor: colors.accentSoft,
  },
  letter: { fontSize: 20, lineHeight: 28, color: colors.text, fontFamily: 'serif' },
});
