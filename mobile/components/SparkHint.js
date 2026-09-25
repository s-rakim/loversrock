// "Hint · 5 ✨" button for games: spends Sparks on the server, then reveals.
import React from 'react';
import { Alert } from 'react-native';
import { apiFetch } from '../services/api';
import { Button } from './ui';
import { t } from '../i18n';

export default function SparkHint({ game, onReveal, style }) {
  async function use() {
    try {
      const { balance } = await apiFetch('/sparks/hint', { method: 'POST', body: { game } });
      onReveal(balance);
    } catch (err) {
      Alert.alert(t('sparks.hintFailed'), err.message);
    }
  }
  return <Button small kind="secondary" icon="bulb-outline" title={t('sparks.hintButton')} onPress={use} style={style} />;
}
