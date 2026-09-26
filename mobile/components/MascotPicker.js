// "Your mascot": the picture that stands for you, everywhere the app shows
// the two of you — the mood bar, the wardrobe, the distance widget.
//
// By default, your shipped picture: the app carries one of each of you, and
// "Which picture is you?" says which is yours (which also puts her on the
// left of the distance widget and him on the right). Upload any picture to
// replace your own; "Use the default" brings the shipped one back.
//
// An upload can be any picture you like. It is shrunk on the phone before it is sent (nobody
// needs a 12-megapixel mascot, and the server has no image tools of its own),
// with a second, tiny copy made for home-screen widgets. PNGs stay PNG so a
// cut-out with a transparent background stays transparent.
import React, { useMemo, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { apiFetch } from '../services/api';
import { refreshWidgets } from '../services/widgetBridge';
import { spacing, radius } from '../theme';
import { useTheme } from './ThemeContext';
import Character from './Character';
import { DEFAULT_ART } from '../assets/mascot';
import useMascotOwners, { refreshMascotOwners } from './useMascotOwners';

// Longest side, in pixels. Plenty for a figure a few hundred points tall on
// the densest screen; the thumbnail is what a widget can carry.
const FULL = 1080;
const THUMB = 256;

function resizeFor(asset, limit) {
  const { width, height } = asset;
  if (!width || !height || Math.max(width, height) <= limit) return [];
  return [{ resize: width >= height ? { width: limit } : { height: limit } }];
}

async function prepare(asset) {
  const png = /png/i.test(asset.mimeType || '') || /\.png$/i.test(asset.uri);
  const format = png ? SaveFormat.PNG : SaveFormat.JPEG;
  const mime = png ? 'image/png' : 'image/jpeg';
  const full = await manipulateAsync(asset.uri, resizeFor(asset, FULL), { compress: 0.82, format, base64: true });
  const thumb = await manipulateAsync(asset.uri, resizeFor(asset, THUMB), { compress: 0.85, format, base64: true });
  return {
    image: `data:${mime};base64,${full.base64}`,
    thumb: `data:${mime};base64,${thumb.base64}`,
    width: Math.round(full.width),
    height: Math.round(full.height),
  };
}

export default function MascotPicker() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { owners, pictures } = useMascotOwners();
  const [busy, setBusy] = useState(null);   // 'upload' | 'remove' | 'side'

  async function choose() {
    if (busy) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photos', 'Allow access to your photos to choose a mascot.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      // Free crop, so you can cut yourself out of a bigger photo.
      allowsEditing: true,
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;

    setBusy('upload');
    try {
      const body = await prepare(result.assets[0]);
      await apiFetch('/profile/mascot', { method: 'PUT', body });
      await refreshMascotOwners();
      refreshWidgets();
    } catch (err) {
      // A 404 here is not a missing picture: it is a server older than the
      // app, without the mascot route. Say what to do about it.
      Alert.alert('Could not set your mascot', err.status === 404
        ? 'Your server is older than the app. Update the backend (docker compose up -d --build) and try again.'
        : err.message);
    } finally {
      setBusy(null);
    }
  }

  function remove() {
    Alert.alert('Use the default picture?', 'Your uploaded picture is removed and your original one comes back.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Use the default',
        style: 'destructive',
        onPress: async () => {
          setBusy('remove');
          try {
            await apiFetch('/profile/mascot', { method: 'DELETE' });
            await refreshMascotOwners();
            refreshWidgets();
          } catch (err) {
            Alert.alert('Could not remove it', err.message);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  // Which shipped picture is you. It also sets the distance widget's sides:
  // 'b' stands on the left, 'a' on the right.
  async function claim(art) {
    if (owners.me === art || busy) return;
    setBusy('side');
    try {
      await apiFetch('/profile/preferences', { method: 'PATCH', body: { mascotArt: art } });
      await refreshMascotOwners();
      refreshWidgets();
    } catch (err) {
      Alert.alert('Could not save', err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={font.body}>Your mascot</Text>
      <Text style={font.muted}>
        Your picture stands for you in the app and on the widgets. Keep the original, or upload any
        picture you like instead.
      </Text>

      <View style={styles.stage}>
        <View style={styles.figure}>
          <Character who="me" height={150} animated={false} />
          <Text style={styles.caption}>You</Text>
        </View>
        <View style={styles.figure}>
          <Character who="partner" height={150} animated={false} />
          <Text style={styles.caption}>Your partner</Text>
        </View>
      </View>

      <View style={styles.buttons}>
        <Pressable onPress={choose} style={[styles.button, styles.primary]} accessibilityRole="button">
          {busy === 'upload'
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryLabel}>{pictures.me ? 'Upload another' : 'Upload your own'}</Text>}
        </Pressable>
        {pictures.me && (
          <Pressable onPress={remove} style={styles.button} accessibilityRole="button">
            {busy === 'remove'
              ? <ActivityIndicator color={colors.textSecondary} />
              : <Text style={styles.secondaryLabel}>Use the default</Text>}
          </Pressable>
        )}
      </View>

      {/* Which of the two original pictures is you. One answer settles both
          phones, and her picture stands on the left of the distance widget. */}
      <Text style={[font.muted, { marginTop: spacing.md }]}>Which original picture is you?</Text>
      <View style={styles.claimRow}>
        {['a', 'b'].map((art) => {
          const mine = owners.me === art;
          return (
            <Pressable
              key={art}
              onPress={() => claim(art)}
              accessibilityRole="button"
              accessibilityState={{ selected: mine, busy: busy === 'side' }}
              accessibilityLabel={mine ? 'This original picture is you' : 'Choose this original picture as you'}
              style={[styles.claim, mine && styles.claimActive]}
            >
              <Image source={DEFAULT_ART[art].source} style={styles.claimPhoto} resizeMode="contain" />
              <Text style={[styles.segmentLabel, mine && styles.segmentLabelActive]}>{mine ? 'You' : 'Your partner'}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, gap: 4,
  },
  stage: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end',
    marginTop: spacing.md, minHeight: 170,
  },
  figure: { alignItems: 'center' },
  caption: { marginTop: spacing.xs, fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  button: {
    flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
  },
  primary: { backgroundColor: colors.accentPink, borderColor: colors.accentPink },
  primaryLabel: { color: '#fff', fontWeight: '700' },
  secondaryLabel: { color: colors.textSecondary, fontWeight: '600' },
  claimRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  claim: {
    flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md,
    borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surfaceAlt,
  },
  claimActive: { borderColor: colors.accentPink },
  claimPhoto: { height: 110, aspectRatio: 0.4, marginBottom: spacing.xs },
  segmentLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  segmentLabelActive: { color: colors.accentPink },
});
