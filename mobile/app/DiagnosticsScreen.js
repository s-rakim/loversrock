// What is actually working on this phone.
//
// Written after three rounds of "the calls don't work and the images don't
// work", where the fixes were real, the tests were green, and there was no
// way to tell from the outside which link in the chain was broken — or
// whether the build carrying the fix had even been installed.
//
// Every check here does the real thing rather than reporting what the app
// believes. The media check uploads a pixel and loads it back through an
// actual <Image>, because "the request returns 200" and "the picture appears"
// are different claims and only the second one matters.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, ActivityIndicator, Platform,
  PermissionsAndroid, Share,
} from 'react-native';
import Constants from 'expo-constants';
import { apiFetch, pingServer, getApiUrl, getAccessToken, mediaUrl, connectSocket, waitForSocket, getSocketState, isUnpaired, getSocketRefusal, UNPAIRED_ERROR } from '../services/api';
import { BUILD_STAMP, API_CONTRACT } from '../buildInfo';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import { MorphButton } from '../components/Motion';
import Icon from '../components/Icon';

// A real 1x1 PNG. Uploading actual image bytes is the point — a base64-shaped
// string would pass a check that the image pipeline would still fail.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const OK = 'ok';
const BAD = 'bad';
const WARN = 'warn';

/**
 * A check that failed only because nobody is paired yet.
 *
 * Every two-person endpoint answers 403 "Not currently paired" before
 * pairing, and each of those used to show as its own red cross: upload,
 * calls, the live connection. Four red failures for one missing step sends
 * somebody hunting four problems. The "Paired" row stays red — it is the one
 * thing to act on — and everything downstream of it points back to it.
 */
const WAITING_ON_PAIR = 'Waiting on pairing — see "Paired" above';
const verdict = (err) => (isUnpaired(err) ? [WARN, WAITING_ON_PAIR] : [BAD, err.message]);

export default function DiagnosticsScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [probeUrl, setProbeUrl] = useState(null);
  const [imageVerdict, setImageVerdict] = useState(null);

  const run = useCallback(async () => {
    setRunning(true);
    setResults([]);
    setProbeUrl(null);
    setImageVerdict(null);

    const found = [];
    const add = (label, status, detail) => {
      found.push({ label, status, detail });
      setResults([...found]);
    };

    // ---------------------------------------------------------------- build
    add('Build', OK, `${Constants.expoConfig?.version || '?'} · ${BUILD_STAMP}`);
    add('Server address', OK, getApiUrl());

    // --------------------------------------------------------------- server
    try {
      await pingServer();
      add('Server reachable', OK, 'GET /health answered');
    } catch (err) {
      add('Server reachable', BAD, err.message);
      // Nothing below can pass if the server is unreachable, and a screen
      // full of red that all means one thing is worse than one red line.
      setRunning(false);
      return;
    }

    // ----------------------------------------------------------------- auth
    const token = await getAccessToken();
    add('Signed in', token ? OK : BAD, token ? 'Access token present' : 'No token — log in again');

    let me = null;
    try {
      const profile = await apiFetch('/profile');
      me = profile?.me;
      add('Authenticated request', OK, `Signed in as ${me?.displayName || me?.name || me?.id}`);
      add('Paired', profile?.paired ? OK : BAD,
        profile?.paired
          ? `With ${profile.partner?.displayName || 'your partner'}`
          : 'Not paired yet — messages, calls and shared photos start once you pair');
    } catch (err) {
      add('Authenticated request', BAD, err.message);
    }

    // --------------------------------------------------------------- socket
    // The live connection. Messages arriving, and every call, ride on this.
    try {
      await connectSocket();
      await waitForSocket(10000);
      add('Live connection', OK, 'Socket connected and in your pair room');
    } catch (err) {
      // Refused for want of a partner is not a network fault — this used to
      // tell people to check Tailscale when the server had simply said no.
      if (getSocketRefusal() === UNPAIRED_ERROR) add('Live connection', WARN, WAITING_ON_PAIR);
      else add('Live connection', BAD, `${err.message} (state: ${getSocketState()})`);
    }

    // ---------------------------------------------------------------- media
    // The one that matters for "the images don't work": upload a pixel, then
    // load it back exactly the way a photo in the thread is loaded.
    try {
      const sent = await apiFetch('/memories', { method: 'POST', body: { image: PIXEL, caption: 'diagnostics' } });
      const key = sent?.memory?.image_url;
      add('Image upload', key ? OK : BAD, key ? `Stored as ${key}` : 'No storage key came back');

      if (key) {
        const url = mediaUrl(key);
        add('Signed image URL', url?.includes('token=') ? OK : BAD,
          url?.includes('token=') ? 'URL carries an access token' : 'URL is unsigned — it will 401');

        // The plain GET an image loader makes, with no headers of its own.
        const res = await fetch(url);
        const type = res.headers.get('content-type') || '(none)';
        add('Image download', res.ok ? OK : BAD, `HTTP ${res.status} · ${type}`);
        add('Served as an image', /^image\//.test(type) ? OK : BAD, type);

        // And the part no fetch can answer: does the native loader paint it?
        setProbeUrl(url);
      }
    } catch (err) {
      add('Image upload', ...verdict(err));
    }

    // ---------------------------------------------------------------- calls
    let webrtc = false;
    try {
      // eslint-disable-next-line global-require
      const rtc = require('react-native-webrtc');
      webrtc = typeof rtc.RTCPeerConnection === 'function';
      add('WebRTC module', webrtc ? OK : BAD,
        webrtc ? 'Native module loaded' : 'Loaded but RTCPeerConnection is missing');
    } catch (err) {
      add('WebRTC module', BAD, `Not in this build — calls cannot work. ${err.message}`);
    }

    try {
      // eslint-disable-next-line global-require
      const incall = require('react-native-incall-manager').default;
      add('Audio routing', incall ? OK : WARN,
        incall ? 'InCallManager available' : 'Missing — the speaker button will do nothing');
    } catch {
      add('Audio routing', WARN, 'InCallManager not in this build — no speaker control');
    }

    if (Platform.OS === 'android') {
      const mic = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      const cam = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
      add('Microphone permission', mic ? OK : WARN, mic ? 'Granted' : 'Not granted yet — you will be asked on the first call');
      add('Camera permission', cam ? OK : WARN, cam ? 'Granted' : 'Not granted yet — you will be asked on the first video call');
    }

    try {
      const config = await apiFetch('/calls/config');
      const count = config?.iceServers?.length || 0;
      add('Call servers', count > 0 ? OK : BAD, `${count} ICE server${count === 1 ? '' : 's'}`);
      // Without TURN, two phones behind strict NAT cannot connect at all.
      // On one tailnet that never comes up; on mobile data it can.
      add('TURN relay', config?.hasTurn ? OK : WARN,
        config?.hasTurn
          ? 'Configured — calls work even behind strict NAT'
          : 'Not configured. Fine on Tailscale; calls may fail on some mobile networks');
    } catch (err) {
      add('Call servers', ...verdict(err));
    }

    try {
      const current = await apiFetch('/calls/current');
      add('Calls not blocked', current?.call ? WARN : OK,
        current?.call
          ? `A call is marked ${current.call.status} — a new one may be refused until it clears`
          : 'No stale call is holding the line');
    } catch (err) {
      add('Calls not blocked', WARN, err.message);
    }

    setRunning(false);
  }, []);

  const shareReport = () => {
    const lines = results.map((r) => `${r.status.toUpperCase()}  ${r.label}: ${r.detail}`);
    if (imageVerdict) lines.push(`${imageVerdict.toUpperCase()}  Image renders on screen`);
    Share.share({ message: `loversrock diagnostics\n\n${lines.join('\n')}` }).catch(() => {});
  };

  const badge = (status) => {
    if (status === OK) return { name: 'checkmark-circle', colour: colors.success };
    if (status === WARN) return { name: 'alert-circle', colour: colors.gold };
    return { name: 'close-circle', colour: colors.danger };
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={font.h2}>Diagnostics</Text>
        <Text style={[font.muted, { marginTop: spacing.xs }]}>
          Runs the real thing at each step — uploads a pixel, opens a socket,
          asks for the call configuration — and says which one fails.
        </Text>

        <MorphButton onPress={run} disabled={running} style={[styles.run, running && styles.disabled]}>
          {running
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.runText}>Run checks</Text>}
        </MorphButton>
      </View>

      {results.length > 0 && (
        <View style={styles.card}>
          {results.map((r) => {
            const look = badge(r.status);
            return (
              <View key={r.label} style={styles.row}>
                <Icon name={look.name} chip={false} size={20} color={look.colour} />
                <View style={{ flex: 1 }}>
                  <Text style={[font.body, { fontWeight: '600' }]}>{r.label}</Text>
                  <Text style={font.muted}>{r.detail}</Text>
                </View>
              </View>
            );
          })}

          {probeUrl && (
            <View style={styles.row}>
              <Icon
                name={imageVerdict === OK ? 'checkmark-circle' : imageVerdict === BAD ? 'close-circle' : 'ellipse-outline'}
                chip={false}
                size={20}
                color={imageVerdict === OK ? colors.success : imageVerdict === BAD ? colors.danger : colors.textMuted}
              />
              <View style={{ flex: 1 }}>
                <Text style={[font.body, { fontWeight: '600' }]}>Image renders on screen</Text>
                <Text style={font.muted}>
                  {imageVerdict === OK ? 'The picture below loaded'
                    : imageVerdict === BAD ? 'The loader refused it — this is why photos are blank'
                      : 'Loading…'}
                </Text>
              </View>
              {/* Deliberately visible. A 1x1 scaled up is a solid square: if
                  you can see it, the whole image path works end to end. */}
              <Image
                source={{ uri: probeUrl }}
                style={styles.probe}
                onLoad={() => setImageVerdict(OK)}
                onError={() => setImageVerdict(BAD)}
              />
            </View>
          )}

          <MorphButton onPress={shareReport} style={styles.share}>
            <Icon name="share-outline" chip={false} size={16} color={colors.accent} />
            <Text style={{ color: colors.accent, fontWeight: '600' }}>Share this report</Text>
          </MorphButton>
        </View>
      )}

      <View style={styles.card}>
        <Text style={font.h3}>Build</Text>
        <Text style={[font.muted, { marginTop: spacing.xs }]}>
          {Constants.expoConfig?.version || '?'} · {BUILD_STAMP} · contract v{API_CONTRACT}
        </Text>
        <Text style={[font.muted, { marginTop: spacing.sm, fontSize: 11 }]}>
          If this stamp is older than the fix you are testing, the phone is
          still running the previous build.
        </Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    content: { padding: spacing.lg, paddingBottom: spacing.xl * 3 },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
      borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
    },
    run: {
      backgroundColor: colors.accent, borderRadius: radius.pill,
      paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md,
    },
    disabled: { opacity: 0.6 },
    runText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    probe: { width: 34, height: 34, borderRadius: 8, backgroundColor: colors.surfaceAlt },
    share: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
      backgroundColor: colors.accentSoft, borderRadius: radius.pill,
      paddingVertical: spacing.sm, marginTop: spacing.md,
    },
  });
