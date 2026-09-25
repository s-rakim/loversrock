// Memories as a calendar: every shared moment of the month — photos, snaps,
// posts, dates, bucket-list wins, check-ins, challenges, drawings and
// achievements — so the app slowly becomes your relationship's history.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Image, Alert, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, mediaUrl } from '../services/api';
import { Card, Screen, Empty, ui } from '../components/ui';
import Icon from '../components/Icon';
import { useI18n } from '../i18n';
import { colors, font, spacing, radius } from '../theme';

const TYPE_COLOR = { memory: '#E8607A', snap: '#FF8A65', post: '#7B1FA2', date: '#2B3F8C', bucket: '#00897B', challenge: '#F9A825', drawing: '#3FB8AF', achievement: '#D9A441', checkin: '#C2185B', countdown: '#8C7F79' };

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export default function TimelineScreen() {
  const { t } = useI18n();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);

  useFocusEffect(useCallback(() => {
    apiFetch(`/timeline?month=${month}`).then((d) => { setData(d); setSelected(d.days[d.days.length - 1]?.date || null); })
      .catch((err) => Alert.alert(t('common.error'), err.message));
  }, [month]));

  const byDay = useMemo(() => Object.fromEntries((data?.days || []).map((d) => [d.date, d.events])), [data]);
  const [y, m] = month.split('-').map(Number);
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const events = selected ? byDay[selected] || [] : [];

  return (
    <Screen>
      <View style={[ui.row, { justifyContent: 'space-between', marginBottom: spacing.md }]}>
        <Icon name="chevron-back" onPress={() => setMonth(shiftMonth(month, -1))} />
        <Text style={font.h1}>{new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString([], { month: 'long', year: 'numeric' })}</Text>
        <Icon name="chevron-forward" onPress={() => setMonth(shiftMonth(month, 1))} />
      </View>
      <Card>
        <View style={styles.week}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <Text key={i} style={styles.weekday}>{d}</Text>)}</View>
        <View style={styles.grid}>
          {cells.map((date, i) => {
            const evts = date ? byDay[date] : null;
            const photo = evts?.find((e) => e.imageUrl);
            return (
              <Pressable key={i} style={[styles.cell, selected === date && styles.cellSelected]} onPress={() => date && setSelected(date)}>
                {photo ? <Image source={{ uri: mediaUrl(photo.imageUrl) }} style={styles.cellPhoto} /> : null}
                {date ? <Text style={[styles.dayNum, photo && { color: '#fff', fontWeight: '800' }]}>{Number(date.slice(8))}</Text> : null}
                {evts && !photo ? (
                  <View style={styles.dots}>{evts.slice(0, 3).map((e, j) => <View key={j} style={[styles.dot, { backgroundColor: TYPE_COLOR[e.type] }]} />)}</View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </Card>
      <Text style={[font.h2, { marginBottom: spacing.sm }]}>{selected ? new Date(`${selected}T12:00:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) : ''}</Text>
      {events.length === 0 ? <Empty icon="calendar-clear-outline" text={t('timeline.empty')} /> : events.map((e) => (
        <Card key={`${e.type}-${e.id}`} style={ui.row}>
          {e.imageUrl ? <Image source={{ uri: mediaUrl(e.imageUrl) }} style={styles.thumb} /> : (
            <Icon name={e.icon} chip chipSize={44} color={TYPE_COLOR[e.type]} chipColor={colors.surfaceAlt} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={[font.muted, { color: TYPE_COLOR[e.type], fontWeight: '700' }]}>{t(`timeline.type.${e.type}`)}</Text>
            <Text style={font.body} numberOfLines={2}>{e.title}</Text>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  week: { flexDirection: 'row' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', ...font.muted, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, overflow: 'hidden' },
  cellSelected: { borderWidth: 2, borderColor: colors.accent },
  cellPhoto: { ...StyleSheet.absoluteFillObject, opacity: 0.85 },
  dayNum: { color: colors.text, fontSize: 13 },
  dots: { flexDirection: 'row', gap: 2, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  thumb: { width: 44, height: 44, borderRadius: radius.sm },
});
