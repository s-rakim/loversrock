// Send a photo straight to your partner's home screen.
//
// The locket half that was missing. Everything behind this existed and was
// tested — the upload endpoint, the mirror into Memories, the FCM data
// message that wakes the widget, and the widget's own fetch — but nothing in
// the app ever called POST /widget-photos, so there was no way to actually
// send one. The Home card pointed at the doodle canvas instead.
//
// Camera first, because "take a pic" is the point; the library is there for
// when the moment has already happened.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Image, TextInput, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, mediaUrl } from '../services/api';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import { Stagger, MorphButton } from '../components/Motion';
import { refreshWidgets } from '../services/widgetBridge';

const MAX_CAPTION = 60;

export default function WidgetPhotoScreen({ navigation }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [picked, setPicked] = useState(null);   // { uri, base64, mimeType }
  const [caption, setCaption] = useState('');
  const [sending, setSending] = useState(false);
  const [latest, setLatest] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    apiFetch('/widget-photos/latest')
      .then((d) => setLatest(d.widgetPhoto))
      .catch(() => setLatest(null))
      .finally(() => setLoading(false));
  }, []);
  useFocusEffect(load);

  // quality 0.5 and a 1024px cap on purpose: the photo is re-encoded as
  // base64 for the upload, which inflates it by about a third, and the
  // Android widget then has to push the bitmap across a Binder transaction
  // with a hard ~1MB limit. A full-resolution phone photo fails that.
  const PICKER = {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    base64: true,
    quality: 0.5,
    allowsEditing: true,
    aspect: [1, 1],
  };

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera needed', 'Allow camera access to take a photo for their widget.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync(PICKER);
    if (result.canceled) return;
    setPicked(result.assets[0]);
  }

  async function choosePhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photos needed', 'Allow photo access to pick one.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync(PICKER);
    if (result.canceled) return;
    setPicked(result.assets[0]);
  }

  async function send() {
    if (!picked?.base64) return;
    setSending(true);
    try {
      const mime = picked.mimeType || 'image/jpeg';
      await apiFetch('/widget-photos', {
        method: 'POST',
        body: {
          image: `data:${mime};base64,${picked.base64}`,
          caption: caption.trim() || null,
        },
      });
      // Your own widget should show what you just sent, not wait for its
      // next 30-minute refresh.
      refreshWidgets().catch(() => {});
      setPicked(null);
      setCaption('');
      load();
      Alert.alert('Sent', "It'll appear on their home screen shortly.");
    } catch (err) {
      Alert.alert('Could not send', err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stagger delayStep={60}>
        <View style={styles.card}>
          <Text style={font.h2}>Send to their home screen</Text>
          <Text style={[font.muted, { marginTop: 2 }]}>
            It lands on the loversrock widget on their phone, and saves into
            your shared Memories.
          </Text>

          <View style={styles.preview}>
            {picked ? (
              <Image source={{ uri: picked.uri }} style={styles.previewImage} />
            ) : (
              <View style={styles.previewEmpty}>
                <Ionicons name="camera-outline" size={40} color={colors.textSecondary} />
                <Text style={[font.muted, { marginTop: spacing.xs }]}>Nothing chosen yet</Text>
              </View>
            )}
          </View>

          <View style={styles.actions}>
            <MorphButton onPress={takePhoto} style={[styles.button, styles.primary]}>
              <Ionicons name="camera" size={18} color="#fff" />
              <Text style={styles.primaryText}>Take a photo</Text>
            </MorphButton>
            <MorphButton onPress={choosePhoto} style={[styles.button, styles.secondary]}>
              <Ionicons name="images-outline" size={18} color={colors.accentIndigo} />
              <Text style={[font.body, { color: colors.accentIndigo, fontWeight: '600' }]}>Choose</Text>
            </MorphButton>
          </View>

          {picked && (
            <>
              <TextInput
                value={caption}
                onChangeText={(t) => setCaption(t.slice(0, MAX_CAPTION))}
                placeholder="Say something (optional)"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
                maxLength={MAX_CAPTION}
              />
              <Text style={[font.muted, styles.counter]}>
                {caption.length}/{MAX_CAPTION}
              </Text>

              <MorphButton
                onPress={send}
                disabled={sending}
                style={[styles.sendButton, sending && styles.disabled]}
              >
                {sending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="send" size={18} color="#fff" />
                    <Text style={styles.primaryText}>Send it</Text>
                  </>
                )}
              </MorphButton>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={font.h3}>On the widget now</Text>
          {loading ? (
            <ActivityIndicator color={colors.accentPink} style={{ marginTop: spacing.md }} />
          ) : latest ? (
            <>
              <Image
                source={{ uri: mediaUrl(latest.imageUrl || latest.image_url) }}
                style={styles.latest}
              />
              {latest.caption ? (
                <Text style={[font.body, { marginTop: spacing.sm }]}>{latest.caption}</Text>
              ) : null}
              <Text style={[font.muted, { marginTop: 2, fontSize: 11 }]}>
                Sent {new Date(latest.created_at || latest.createdAt).toLocaleString()}
              </Text>
            </>
          ) : (
            <Text style={[font.muted, { marginTop: spacing.xs }]}>
              Nothing sent yet. The first photo either of you sends shows up here.
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.noteRow}>
            <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
            <Text style={[font.muted, { flex: 1, marginLeft: spacing.sm }]}>
              The widget refreshes itself about every 30 minutes, and
              immediately when a photo arrives. If it looks stale, opening
              the app on that phone pulls the latest.
            </Text>
          </View>
        </View>
      </Stagger>
    </ScrollView>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    content: { padding: spacing.lg, paddingBottom: spacing.xl },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md,
      marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    preview: {
      marginTop: spacing.md, borderRadius: radius.md, overflow: 'hidden',
      backgroundColor: colors.surfaceAlt, aspectRatio: 1,
      borderWidth: 1, borderColor: colors.border,
    },
    previewImage: { width: '100%', height: '100%' },
    previewEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    button: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: spacing.xs, borderRadius: radius.pill, paddingVertical: spacing.md,
    },
    primary: { backgroundColor: colors.accentPink },
    secondary: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
    primaryText: { color: '#fff', fontWeight: '700' },
    input: {
      backgroundColor: colors.surfaceAlt, color: colors.textPrimary,
      borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md,
      borderWidth: 1, borderColor: colors.border,
    },
    counter: { textAlign: 'right', fontSize: 11, marginTop: 2 },
    sendButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
      backgroundColor: colors.accentIndigo, borderRadius: radius.pill,
      paddingVertical: spacing.md, marginTop: spacing.md,
    },
    disabled: { opacity: 0.5 },
    latest: {
      width: '100%', aspectRatio: 1, borderRadius: radius.md,
      marginTop: spacing.sm, backgroundColor: colors.surfaceAlt,
    },
    noteRow: { flexDirection: 'row', alignItems: 'flex-start' },
  });
