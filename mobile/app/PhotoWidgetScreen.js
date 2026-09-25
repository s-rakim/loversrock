// The locket: take a picture, it lands on their home screen.
//
// Built to the shape of the app in the reference screenshots, because that
// shape is right for what this does — the camera IS the screen, not a field
// on a form. One tap sends. Everything else is small and out of the way.
//
// The previous version was a card with a "Take a photo" button that opened
// the system camera, came back with a preview, and asked you to press Send.
// Four taps to do the thing the app exists for.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Alert, ActivityIndicator, TextInput, Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, mediaUrl } from '../services/api';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import { MorphButton } from '../components/Motion';
import { refreshWidgets } from '../services/widgetBridge';

const MAX_CAPTION = 60;

export default function PhotoWidgetScreen({ navigation }) {
  const { colors, font } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const camera = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState('back');
  const [flash, setFlash] = useState('off');
  const [sending, setSending] = useState(false);
  const [shot, setShot] = useState(null);      // { uri, base64 }
  const [caption, setCaption] = useState('');
  const [partner, setPartner] = useState(null);
  // The camera is a real hardware resource. Mounting it while the screen is
  // not on top keeps the sensor awake behind other screens and, on some
  // Android devices, stops any other app opening it at all.
  const [focused, setFocused] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      apiFetch('/profile').then((d) => setPartner(d?.partner || null)).catch(() => {});
      return () => setFocused(false);
    }, [])
  );

  async function capture() {
    if (!camera.current || sending) return;
    try {
      // Half quality and no EXIF: the bytes become base64 for the upload,
      // which inflates them by a third, and the Android widget then pushes
      // the bitmap across a Binder transaction with a hard ~1MB ceiling.
      const photo = await camera.current.takePictureAsync({
        base64: true, quality: 0.5, exif: false, skipProcessing: true,
      });
      setShot(photo);
    } catch (err) {
      Alert.alert('Camera problem', err.message);
    }
  }

  async function pickFromLibrary() {
    const granted = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted.granted) {
      Alert.alert('Photos needed', 'Allow photo access to pick one from your library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true, quality: 0.5, allowsEditing: true, aspect: [1, 1],
    });
    if (result.canceled) return;
    setShot(result.assets[0]);
  }

  async function send() {
    if (!shot?.base64 || sending) return;
    setSending(true);
    try {
      await apiFetch('/widget-photos', {
        method: 'POST',
        body: {
          image: `data:${shot.mimeType || 'image/jpeg'};base64,${shot.base64}`,
          caption: caption.trim() || null,
        },
      });
      // Your own widget should show what you just sent rather than waiting
      // for its next half-hourly refresh.
      refreshWidgets().catch(() => {});
      setShot(null);
      setCaption('');
      Alert.alert('Sent', `It's on ${partner?.displayName || 'their'} home screen.`);
    } catch (err) {
      Alert.alert('Could not send', err.message);
    } finally {
      setSending(false);
    }
  }

  // ------------------------------------------------------------ permission
  if (!permission) {
    return <View style={styles.root}><ActivityIndicator color={colors.accent} /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.centered, { paddingTop: insets.top }]}>
        <Ionicons name="camera-outline" size={44} color={colors.textMuted} />
        <Text style={[font.h2, { marginTop: spacing.md }]}>Camera access</Text>
        <Text style={[font.muted, styles.permissionBody]}>
          The locket takes a picture and puts it straight on their home screen,
          so it needs the camera. Nothing is uploaded until you press send.
        </Text>
        <MorphButton onPress={requestPermission} style={styles.permissionButton}>
          <Text style={styles.sendText}>Allow camera</Text>
        </MorphButton>
        <Pressable onPress={pickFromLibrary} style={{ marginTop: spacing.md }}>
          <Text style={[font.body, { color: colors.accent }]}>Pick from library instead</Text>
        </Pressable>
      </View>
    );
  }

  const previewing = Boolean(shot);

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      {/* ------------------------------------------------------------ top */}
      <View style={styles.topRow}>
        <Pressable
          onPress={() => setFlash((f) => (f === 'off' ? 'on' : 'off'))}
          style={styles.roundSmall}
        >
          <Ionicons
            name={flash === 'on' ? 'flash' : 'flash-off'}
            size={18}
            color={flash === 'on' ? colors.gold : '#fff'}
          />
        </Pressable>

        <View style={styles.pill}>
          <Ionicons name="people" size={16} color="#fff" />
          <Text style={styles.pillText}>
            {partner?.displayName ? `You & ${partner.displayName}` : 'Just you two'}
          </Text>
        </View>

        <Pressable onPress={() => navigation.navigate('Wall')} style={styles.roundSmall}>
          <Ionicons name="images" size={18} color="#fff" />
        </Pressable>
      </View>

      {/* -------------------------------------------------------- viewfinder */}
      <View style={styles.viewfinder}>
        {previewing ? (
          <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : focused ? (
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing={facing}
            flash={flash}
            // Square-ish framing, because that is the shape of the widget it
            // is going to end up in.
            ratio="1:1"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceAlt }]} />
        )}

        {previewing && (
          <View style={styles.captionWrap}>
            <TextInput
              value={caption}
              onChangeText={(t) => setCaption(t.slice(0, MAX_CAPTION))}
              placeholder="Say something…"
              placeholderTextColor="rgba(255,255,255,0.7)"
              style={styles.captionInput}
              maxLength={MAX_CAPTION}
            />
          </View>
        )}
      </View>

      {/* ---------------------------------------------------------- controls */}
      <View style={styles.controls}>
        {previewing ? (
          <>
            <Pressable onPress={() => { setShot(null); setCaption(''); }} style={styles.sideButton}>
              <Ionicons name="close" size={30} color="#fff" />
            </Pressable>

            <Pressable onPress={send} disabled={sending}>
              <View style={[styles.shutterRing, sending && { opacity: 0.6 }]}>
                <View style={[styles.shutter, { backgroundColor: colors.accent }]}>
                  {sending
                    ? <ActivityIndicator color="#fff" />
                    : <Ionicons name="send" size={30} color="#fff" />}
                </View>
              </View>
            </Pressable>

            <Pressable onPress={pickFromLibrary} style={styles.sideButton}>
              <Ionicons name="images-outline" size={28} color="#fff" />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable onPress={pickFromLibrary} style={styles.sideButton}>
              <Ionicons name="images-outline" size={30} color="#fff" />
            </Pressable>

            <Pressable onPress={capture}>
              <View style={styles.shutterRing}>
                <View style={styles.shutter} />
              </View>
            </Pressable>

            <Pressable
              onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
              style={styles.sideButton}
            >
              <Ionicons name="sync" size={30} color="#fff" />
            </Pressable>
          </>
        )}
      </View>

      <Pressable onPress={() => navigation.navigate('Wall')} style={styles.historyRow}>
        <Text style={styles.historyText}>History</Text>
        <Ionicons name="chevron-down" size={18} color={colors.textPrimary} />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent', paddingHorizontal: spacing.md },
    centered: { alignItems: 'center', justifyContent: 'center' },
    permissionBody: { textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.xl },
    permissionButton: {
      backgroundColor: colors.accent, borderRadius: radius.pill,
      paddingVertical: spacing.md, paddingHorizontal: spacing.xl, marginTop: spacing.lg,
    },

    topRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: spacing.lg,
    },
    roundSmall: {
      width: 44, height: 44, borderRadius: 22,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1, borderColor: colors.border,
    },
    pill: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      backgroundColor: colors.surfaceAlt, borderRadius: radius.pill,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
      borderWidth: 1, borderColor: colors.border,
    },
    pillText: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },

    // Square, like the widget it is destined for.
    viewfinder: {
      width: '100%', aspectRatio: 1, borderRadius: 34, overflow: 'hidden',
      backgroundColor: '#000',
    },
    captionWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.md },
    captionInput: {
      backgroundColor: 'rgba(0,0,0,0.45)', color: '#fff',
      borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
      textAlign: 'center', fontSize: 16,
    },

    controls: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
      marginTop: spacing.xl,
    },
    sideButton: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
    shutterRing: {
      width: 92, height: 92, borderRadius: 46,
      borderWidth: 5, borderColor: colors.accent,
      alignItems: 'center', justifyContent: 'center',
    },
    shutter: {
      width: 74, height: 74, borderRadius: 37,
      backgroundColor: colors.textPrimary,
      alignItems: 'center', justifyContent: 'center',
    },
    sendText: { color: '#fff', fontWeight: '700', fontSize: 16 },

    historyRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: spacing.xs, marginTop: spacing.xl,
    },
    historyText: { color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  });
