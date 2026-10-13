// Sparks: the relationship currency. Balance, how to earn, a feature
// carousel "shop" (streak freeze, streak restore, premium dates, decks),
// gifting to your partner, and history.
import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Alert, Dimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { useCouple } from '../components/CoupleContext';
import { Button, Card, Screen, SectionTitle, ui } from '../components/ui';
import Icon from '../components/Icon';
import CelebrationBurst from '../components/Celebration';
import { useI18n } from '../i18n';
import { colors, font, spacing, radius } from '../theme';

const CARD_WIDTH = Dimensions.get('window').width * 0.72;

export default function SparksScreen({ navigation }) {
  const { t } = useI18n();
  const { partner, refresh } = useCouple();
  const [data, setData] = useState(null);
  const [gift, setGift] = useState('10');
  const [burst, setBurst] = useState(0);

  const load = useCallback(() => apiFetch('/sparks').then(setData).catch((err) => Alert.alert(t('common.error'), err.message)), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function buy(path, body) {
    try {
      await apiFetch(path, { method: 'POST', body });
      setBurst((b) => b + 1);
      await load();
      refresh();
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }

  if (!data) return <Screen><Text style={font.muted}>{t('common.loading')}</Text></Screen>;

  const canRestore = data.lostStreak && data.lostStreakOn;
  const shop = [
    { key: 'freeze', icon: 'snow', tint: '#E3F2FD', title: t('sparks.freeze'), body: t('sparks.freezeBody', { n: data.streakFreezes, max: data.maxStreakFreezes }), price: data.prices.streak_freeze,
      action: () => buy('/sparks/streak-freeze'), disabled: data.streakFreezes >= data.maxStreakFreezes },
    { key: 'restore', icon: 'flame', tint: '#FFF0D6', title: t('sparks.restore'), body: canRestore ? t('sparks.restoreBody', { n: data.lostStreak }) : t('sparks.restoreNone'), price: data.prices.streak_restore,
      action: () => buy('/sparks/streak-restore'), disabled: !canRestore },
    { key: 'dates', icon: 'heart-circle', tint: '#FFE1E7', title: t('sparks.dates'), body: t('sparks.datesBody'), price: data.prices.premium_dates,
      action: () => buy('/sparks/unlock', { item: 'dates:premium' }), disabled: data.unlocks.includes('dates:premium') },
    { key: 'decks', icon: 'albums', tint: '#EDE7F6', title: t('sparks.decks'), body: t('sparks.decksBody'), price: null, action: () => navigation.navigate('Connect') },
    { key: 'hints', icon: 'bulb', tint: '#DDF5EA', title: t('sparks.hints'), body: t('sparks.hintsBody', { n: data.prices.game_hint }), price: null, action: () => navigation.navigate('Games') },
  ];

  return (
    <Screen sticker="celebrate">
      <View style={styles.balance}>
        <Icon name="sparkles" size={34} color={colors.gold} chip chipSize={64} chipColor="#FFF4DA" />
        <Text style={styles.balanceText}>{data.balance}</Text>
        <Text style={font.muted}>{t('sparks.balance')}</Text>
        <CelebrationBurst trigger={burst} />
      </View>

      <SectionTitle>{t('sparks.shop')}</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={CARD_WIDTH + spacing.sm} decelerationRate="fast">
        {shop.map((item) => (
          <View key={item.key} style={[styles.shopCard, { backgroundColor: item.tint, width: CARD_WIDTH }]}>
            <Icon name={item.icon} size={26} chip chipSize={52} chipColor="rgba(255,255,255,0.7)" />
            <Text style={[font.h2, { marginTop: spacing.md }]}>{item.title}</Text>
            <Text style={[font.muted, { marginTop: spacing.xs, flex: 1 }]}>{item.body}</Text>
            <Button
              title={item.price ? t('sparks.buy', { n: item.price }) : t('common.open')}
              icon={item.price ? 'sparkles' : 'arrow-forward'}
              onPress={item.action}
              disabled={item.disabled || (item.price && data.balance < item.price)}
              style={{ marginTop: spacing.md }}
            />
          </View>
        ))}
      </ScrollView>

      <SectionTitle>{t('sparks.gift', { name: partner?.name || t('profile.partner') })}</SectionTitle>
      <Card style={ui.row}>
        <TextInput value={gift} onChangeText={setGift} keyboardType="number-pad" style={[ui.input, { width: 90, textAlign: 'center' }]} />
        <Button title={t('sparks.send')} icon="gift" style={{ flex: 1 }} onPress={() => buy('/sparks/gift', { amount: Number(gift) })} />
      </Card>

      <SectionTitle>{t('sparks.earn')}</SectionTitle>
      <Card>
        {Object.entries(data.rewards).filter(([k]) => k !== 'welcome').map(([k, v]) => (
          <View key={k} style={styles.row}>
            <Text style={font.body}>{t(`sparks.reward.${k}`)}</Text>
            <Text style={styles.plus}>+{v}</Text>
          </View>
        ))}
        <View style={styles.row}><Text style={font.body}>{t('sparks.reward.achievements')}</Text><Text style={styles.plus}>+10–200</Text></View>
      </Card>

      <SectionTitle>{t('sparks.history')}</SectionTitle>
      <Card>
        {data.history.map((h) => (
          <View key={h.id} style={styles.row}>
            <Text style={[font.body, { flex: 1 }]} numberOfLines={1}>{t(`sparks.reason.${h.reason}`)}{h.ref && h.reason.startsWith('gift') ? ` · ${h.ref}` : ''}</Text>
            <Text style={[styles.plus, h.amount < 0 && { color: colors.danger }]}>{h.amount > 0 ? `+${h.amount}` : h.amount}</Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  balance: { alignItems: 'center', paddingVertical: spacing.lg },
  balanceText: { fontSize: 48, fontWeight: '800', color: colors.text, marginTop: spacing.sm },
  shopCard: { borderRadius: radius.xl, padding: spacing.lg, marginRight: spacing.sm, minHeight: 250 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  plus: { fontWeight: '800', color: colors.success },
});
