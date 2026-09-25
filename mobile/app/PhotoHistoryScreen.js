// Every locket ever sent, as a wall rather than a list.
//
// Built to the reference screenshot: tiles scattered across a dotted
// pegboard, grouped into month panels, with the running totals at the foot.
//
// On the scatter. It has to look casual and it must not MOVE — a layout that
// reshuffles whenever the list re-renders reads as a glitch, and React will
// re-render this on every focus. So the offsets are derived from each photo's
// own id through a small hash: the same photo lands in the same place
// forever, on both phones, without storing a position anywhere.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, Pressable, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, mediaUrl } from '../services/api';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import { FadeInUp } from '../components/Motion';

const COLUMNS = 5;
const DOT_ROWS = 6;

/**
 * A stable pseudo-random number in [0,1) from a string.
 *
 * FNV-1a, because it is four lines and has no dependency. The quality bar
 * here is "looks unarranged", not cryptographic.
 */
function hashUnit(text, salt = 0) {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Groups newest-first photos into month buckets, in the reader's timezone. */
export function groupByMonth(photos) {
  const months = [];
  const index = new Map();

  for (const photo of photos) {
    const date = new Date(photo.created_at || photo.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (!index.has(key)) {
      const bucket = {
        key,
        label: date.toLocaleDateString([], { month: 'long', year: 'numeric' }),
        photos: [],
      };
      index.set(key, bucket);
      months.push(bucket);
    }
    index.get(key).photos.push(photo);
  }
  return months;
}

/** The pegboard the tiles sit on. */
function Dots({ width, height, colour }) {
  const dots = useMemo(() => {
    const out = [];
    const stepX = width / COLUMNS;
    const stepY = 74;
    const rows = Math.max(2, Math.ceil(height / stepY));
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < COLUMNS; col += 1) {
        out.push(
          <Circle
            key={`${row}-${col}`}
            cx={stepX * (col + 0.5)}
            cy={stepY * (row + 0.5)}
            r={5}
            fill={colour}
          />
        );
      }
    }
    return out;
  }, [width, height, colour]);

  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      {dots}
    </Svg>
  );
}

function Wall({ photos, width, onPress, showAdd, onAdd, colors }) {
  const cell = width / COLUMNS;
  const tile = cell * 0.78;
  const rows = Math.ceil((photos.length + (showAdd ? 1 : 0)) / COLUMNS);
  const height = Math.max(rows, 2) * 74 + 20;

  return (
    <View style={{ width, height }}>
      <Dots width={width} height={height} colour={colors.surfaceAlt} />
      {photos.map((photo, i) => {
        const col = i % COLUMNS;
        const row = Math.floor(i / COLUMNS);
        // A nudge of up to a third of a cell in each direction, fixed per id.
        const jitterX = (hashUnit(photo.id, 1) - 0.5) * cell * 0.6;
        const jitterY = (hashUnit(photo.id, 2) - 0.5) * 28;
        const tilt = (hashUnit(photo.id, 3) - 0.5) * 14;

        return (
          <Pressable
            key={photo.id}
            onPress={() => onPress(photo)}
            style={{
              position: 'absolute',
              left: cell * col + (cell - tile) / 2 + jitterX,
              top: 74 * row + jitterY + 8,
              transform: [{ rotate: `${tilt}deg` }],
            }}
          >
            <Image
              source={{ uri: mediaUrl(photo.image_url) }}
              style={{
                width: tile, height: tile, borderRadius: 14,
                backgroundColor: colors.surfaceAlt,
              }}
            />
          </Pressable>
        );
      })}

      {showAdd && (
        <Pressable
          onPress={onAdd}
          style={{
            position: 'absolute',
            left: cell * (photos.length % COLUMNS) + (cell - tile) / 2,
            top: 74 * Math.floor(photos.length / COLUMNS) + 8,
            width: tile, height: tile, borderRadius: 14,
            borderWidth: 2, borderColor: colors.accent,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Ionicons name="add" size={28} color={colors.accent} />
        </Pressable>
      )}
    </View>
  );
}

export default function PhotoHistoryScreen({ navigation }) {
  const { colors, font } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [photos, setPhotos] = useState([]);
  const [total, setTotal] = useState(0);
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      apiFetch('/widget-photos')
        .then((d) => {
          setPhotos(d.widgetPhotos || []);
          setTotal(d.total || 0);
          setStreak(d.streak || 0);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [])
  );

  const months = useMemo(() => groupByMonth(photos), [photos]);
  const wallWidth = width - spacing.lg * 2 - spacing.md * 2;

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>;
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: 140 }}
    >
      <View style={styles.header}>
        <Text style={font.h1}>Memories</Text>
        <Pressable onPress={() => navigation.navigate('Locket')} style={styles.cameraButton}>
          <Ionicons name="camera" size={20} color={colors.accent} />
        </Pressable>
      </View>

      {months.length === 0 ? (
        <View style={styles.card}>
          <View style={styles.emptyInner}>
            <Ionicons name="camera-outline" size={40} color={colors.textMuted} />
            <Text style={[font.body, { marginTop: spacing.sm }]}>No lockets yet.</Text>
            <Text style={[font.muted, { marginTop: 2, textAlign: 'center' }]}>
              The first photo either of you sends shows up here — and on the
              other one&apos;s home screen.
            </Text>
            <Pressable
              onPress={() => navigation.navigate('Locket')}
              style={styles.emptyButton}
            >
              <Text style={styles.emptyButtonText}>Send the first one</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        months.map((month, i) => (
          <FadeInUp key={month.key} delay={i * 50}>
            <View style={styles.card}>
              <Text style={[font.h2, styles.monthLabel]}>{month.label}</Text>
              <Wall
                photos={month.photos}
                width={wallWidth}
                colors={colors}
                onPress={(photo) => navigation.navigate('Memories', { focus: photo.image_url })}
                // Only the newest month offers the shortcut back to the camera.
                showAdd={i === 0}
                onAdd={() => navigation.navigate('Locket')}
              />
            </View>
          </FadeInUp>
        ))
      )}

      <View style={styles.statsBar}>
        <View style={styles.stat}>
          <Ionicons name="heart" size={18} color={colors.accent} />
          <Text style={styles.statNumber}>{total}</Text>
          <Text style={font.muted}>{total === 1 ? 'Locket' : 'Lockets'}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Ionicons name="flame" size={18} color={colors.gold} />
          <Text style={styles.statNumber}>{streak}d</Text>
          <Text style={font.muted}>streak</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent', paddingHorizontal: spacing.lg },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    cameraButton: {
      width: 44, height: 44, borderRadius: 22,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.accentSoft,
      borderWidth: 1, borderColor: colors.border,
    },
    card: {
      backgroundColor: colors.surface, borderRadius: 28, padding: spacing.md,
      borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg,
      overflow: 'hidden',
    },
    monthLabel: { marginBottom: spacing.sm },
    emptyInner: { alignItems: 'center', paddingVertical: spacing.xl },
    emptyButton: {
      backgroundColor: colors.accent, borderRadius: radius.pill,
      paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.lg,
    },
    emptyButtonText: { color: '#fff', fontWeight: '700' },

    statsBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: spacing.lg, alignSelf: 'center',
      backgroundColor: colors.surface, borderRadius: radius.pill,
      paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
      borderWidth: 1, borderColor: colors.border,
    },
    stat: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    statNumber: { color: colors.textPrimary, fontWeight: '800', fontSize: 17 },
    statDivider: { width: 1, height: 22, backgroundColor: colors.border },
  });
