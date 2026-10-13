// Every drawing you've saved from the shared Canvas.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert, Dimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import StrokeView from '../components/StrokeView';
import { Card, Screen, Empty, Button, ui } from '../components/ui';
import { FadeInUp } from '../components/Motion';
import { useI18n } from '../i18n';
import { font, spacing } from '../theme';

const TILE = (Dimensions.get('window').width - spacing.lg * 2 - spacing.sm) / 2 - spacing.md * 2;

export default function CanvasGalleryScreen({ navigation }) {
  const { t } = useI18n();
  const [drawings, setDrawings] = useState([]);
  const load = useCallback(() => apiFetch('/canvas/gallery').then((d) => setDrawings(d.drawings)).catch((err) => Alert.alert(t('common.error'), err.message)), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function actions(d) {
    Alert.alert(d.title || t('canvas.untitled'), `${d.created_by_name} · ${new Date(d.created_at).toLocaleDateString()}`, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('canvas.keepDrawing'), onPress: async () => {
        await apiFetch(`/canvas/gallery/${d.id}/restore`, { method: 'POST' }).catch((err) => Alert.alert(t('common.error'), err.message));
        navigation.navigate('SharedCanvas');
      } },
      { text: t('common.delete'), style: 'destructive', onPress: async () => {
        await apiFetch(`/canvas/gallery/${d.id}`, { method: 'DELETE' }).catch(() => {});
        load();
      } },
    ]);
  }

  return (
    <Screen>
      <Button title={t('canvas.open')} icon="brush" onPress={() => navigation.navigate('SharedCanvas')} style={{ marginBottom: spacing.md }} />
      {drawings.length === 0 ? <Empty icon="color-palette-outline" text={t('canvas.galleryEmpty')} /> : (
        <View style={[ui.wrap, { justifyContent: 'space-between' }]}>
          {drawings.map((d, i) => (
            <FadeInUp key={d.id} delay={i * 30}>
              <Card onPress={() => actions(d)}>
                <StrokeView strokes={d.strokes} background={d.background} width={TILE} />
                <Text style={[font.muted, { marginTop: spacing.xs }]} numberOfLines={1}>{d.title || new Date(d.created_at).toLocaleDateString()}</Text>
              </Card>
            </FadeInUp>
          ))}
        </View>
      )}
    </Screen>
  );
}
