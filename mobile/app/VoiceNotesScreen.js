// Every voice note the two of you have sent, and how they behave.
//
// Reached by TAPPING the mic in the nav bar (holding it records). The notes
// play here on demand; the ones that arrive play by themselves, which is set
// up at the top: out loud or not, on silent or not, with which voice effect,
// and in which language to read them.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, Switch, ScrollView, Alert, ActivityIndicator, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, isUnpaired, onSocketEvent } from '../services/api';
import {
  audioUrl, deleteVoiceNote, formatDuration, getNative, getVoiceSettings, listVoiceNotes, setVoiceSettings,
} from '../services/voice';
import { playNote, stopPlayback } from '../components/voice/player';
import { VOICE_FILTER_KEY } from '../components/voice/VoiceMic';
import NotPaired from '../components/NotPaired';
import Icon from '../components/Icon';
import { useTheme } from '../components/ThemeContext';
import { useLanguage } from '../components/LanguageContext';
import { spacing, radius } from '../theme';

const FALLBACK_FILTERS = { chipmunk: 'Chipmunk', deep: 'Deep', robot: 'Robot', echo: 'Echo', radio: 'Radio' };

function timeOf(iso) {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

function Chip({ label, active, onPress, styles }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]} accessibilityState={{ selected: active }}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function VoiceNotesScreen({ navigation }) {
  const { colors, font } = useTheme();
  const { language: appLanguage } = useLanguage();
  const styles = useMemo(() => makeStyles(colors, font), [colors, font]);

  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unpaired, setUnpaired] = useState(false);
  const [ai, setAi] = useState(null);
  const [nativeSettings, setNativeSettings] = useState(null);
  const [filter, setFilter] = useState('none');
  const [playback, setPlayback] = useState({ id: null, playing: false, positionMs: 0, durationMs: 0 });
  const [translating, setTranslating] = useState({});
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const list = await listVoiceNotes();
      if (!mounted.current) return;
      setNotes(list);
      setUnpaired(false);
    } catch (err) {
      if (isUnpaired(err)) setUnpaired(true);
      else Alert.alert('Could not load voice messages', err.message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    apiFetch('/voice/ai').then((d) => mounted.current && setAi(d)).catch(() => {});
    getVoiceSettings().then((s) => mounted.current && setNativeSettings(s));
    AsyncStorage.getItem(VOICE_FILTER_KEY).then((f) => mounted.current && setFilter(f || 'none')).catch(() => {});
  }, [load]));

  useEffect(() => {
    mounted.current = true;
    const offs = [
      onSocketEvent('voice:new', load),
      onSocketEvent('voice:deleted', load),
      onSocketEvent('voice:listened', ({ id, listened_at: at }) => {
        setNotes((list) => list.map((n) => (n.id === id ? { ...n, listened_at: at } : n)));
      }),
      onSocketEvent('voice:transcript', (update) => {
        setNotes((list) => list.map((n) => (n.id === update.id ? { ...n, ...update, id: n.id } : n)));
      }),
    ];
    return () => {
      mounted.current = false;
      offs.forEach((off) => off());
      stopPlayback();
    };
  }, [load]);

  const translateTo = ai?.translateTo || null;
  // What a transcript is shown in when nobody picked anything: the app's own.
  const readIn = translateTo || appLanguage;

  async function toggle(note) {
    if (playback.id === note.id && playback.playing) {
      await stopPlayback();
      setPlayback({ id: null, playing: false, positionMs: 0, durationMs: 0 });
      return;
    }
    try {
      const ok = await playNote({
        id: note.id,
        url: audioUrl(note.path),
        onStatus: (status) => {
          if (!mounted.current) return;
          setPlayback(status.done || status.error ? { id: null, playing: false, positionMs: 0, durationMs: 0 } : status);
          if (status.error) Alert.alert('Could not play it', String(status.error));
        },
      });
      if (!ok) Alert.alert('Update needed', 'Playing voice messages needs the newest version of the app.');
    } catch (err) {
      Alert.alert('Could not play it', err.message);
    }
  }

  function confirmUnsend(note) {
    if (!note.mine) return;
    Alert.alert('Unsend this voice message?', 'It is deleted for both of you.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unsend',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteVoiceNote(note.id);
            setNotes((list) => list.filter((n) => n.id !== note.id));
          } catch (err) {
            Alert.alert('Could not unsend it', err.message);
          }
        },
      },
    ]);
  }

  async function translateNote(note) {
    setTranslating((t) => ({ ...t, [note.id]: true }));
    try {
      const { language, translation } = await apiFetch(`/voice/${note.id}/translate`, {
        method: 'POST', body: { language: readIn },
      });
      setNotes((list) => list.map((n) => (
        n.id === note.id ? { ...n, translations: { ...(n.translations || {}), [language]: translation } } : n
      )));
    } catch (err) {
      Alert.alert('Could not translate it', err.message);
    } finally {
      setTranslating((t) => ({ ...t, [note.id]: false }));
    }
  }

  async function retryTranscript(note) {
    setNotes((list) => list.map((n) => (n.id === note.id ? { ...n, transcript_status: 'pending' } : n)));
    try {
      const { voice } = await apiFetch(`/voice/${note.id}/transcribe`, { method: 'POST' });
      setNotes((list) => list.map((n) => (n.id === note.id ? voice : n)));
    } catch (err) {
      setNotes((list) => list.map((n) => (n.id === note.id ? { ...n, transcript_status: 'failed' } : n)));
      Alert.alert('Could not transcribe it', err.message);
    }
  }

  async function updateNative(patch) {
    const next = { ...nativeSettings, ...patch };
    setNativeSettings(next);
    try {
      await setVoiceSettings(next);
    } catch (err) {
      Alert.alert('Could not save that', err.message);
    }
  }

  async function chooseFilter(next) {
    setFilter(next);
    AsyncStorage.setItem(VOICE_FILTER_KEY, next).catch(() => {});
  }

  async function chooseTranslateTo(code) {
    setAi((current) => ({ ...current, translateTo: code }));
    try {
      await apiFetch('/voice/settings', { method: 'PUT', body: { translateTo: code } });
    } catch (err) {
      Alert.alert('Could not save that', err.message);
    }
  }

  if (unpaired) return <NotPaired navigation={navigation} what="Voice messages" />;

  const filters = ai?.filters || FALLBACK_FILTERS;
  const languages = ai?.languages || {};
  const transcribeOn = Boolean(ai?.transcribe?.on);
  const translateOn = Boolean(ai?.translate?.on);

  const header = (
    <View style={styles.header}>
      <View style={styles.tip}>
        <Icon name="mic" color={colors.accent} size={18} chip={false} />
        <Text style={styles.tipText}>Hold the mic in the middle of the bar to talk. Let go to send, slide up to cancel.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>When one arrives</Text>
        {getNative() && nativeSettings ? (
          <>
            <View style={styles.row}>
              <Text style={styles.rowText}>Play it out loud straight away, even with the app closed or the phone locked</Text>
              <Switch
                value={nativeSettings.autoPlay}
                onValueChange={(v) => updateNative({ autoPlay: v })}
                trackColor={{ true: colors.accent }}
              />
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowText, !nativeSettings.autoPlay && styles.dim]}>Even when my phone is on silent or Do Not Disturb</Text>
              <Switch
                value={nativeSettings.whenSilent}
                disabled={!nativeSettings.autoPlay}
                onValueChange={(v) => updateNative({ whenSilent: v })}
                trackColor={{ true: colors.accent }}
              />
            </View>
            <Text style={styles.muted}>
              When it can’t play — on silent, on a call — it waits in your notifications with a Play button{transcribeOn ? ', and the words' : ''}.
            </Text>
          </>
        ) : (
          <Text style={styles.muted}>
            {Platform.OS === 'ios'
              ? 'On iPhone a voice message arrives as a notification, and plays when you open it. With the app open it plays straight away.'
              : 'With the app open it plays straight away. Install the newest build to have it play with the app closed.'}
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your voice</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="Normal" active={filter === 'none'} onPress={() => chooseFilter('none')} styles={styles} />
          {Object.entries(filters).map(([id, label]) => (
            <Chip key={id} label={label} active={filter === id} onPress={() => chooseFilter(id)} styles={styles} />
          ))}
        </ScrollView>
      </View>

      {translateOn && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Translate what I’m sent into</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="Off" active={!translateTo} onPress={() => chooseTranslateTo(null)} styles={styles} />
            {Object.entries(languages).map(([code, name]) => (
              <Chip key={code} label={name} active={translateTo === code} onPress={() => chooseTranslateTo(code)} styles={styles} />
            ))}
          </ScrollView>
        </View>
      )}
      {ai && !transcribeOn && !translateOn && (
        <Text style={[styles.muted, styles.aiNote]}>
          Transcripts and translation switch on once AI keys are set on the server (backend/.env).
          {ai.transcribe?.problem ? `\n${ai.transcribe.problem}` : ''}
          {ai.translate?.problem ? `\n${ai.translate.problem}` : ''}
        </Text>
      )}
    </View>
  );

  const renderItem = ({ item: note }) => {
    const active = playback.id === note.id;
    const progress = active && playback.durationMs ? Math.min(1, playback.positionMs / playback.durationMs) : 0;
    const translation = note.translations?.[readIn];
    const status = note.transcript_status;

    return (
      <View style={[styles.noteRow, note.mine ? styles.mineRow : styles.theirsRow]}>
        <Pressable
          onPress={() => toggle(note)}
          onLongPress={() => confirmUnsend(note)}
          style={[styles.bubble, note.mine ? styles.mine : styles.theirs]}
          accessibilityRole="button"
          accessibilityLabel={`${note.mine ? 'Your' : 'Their'} voice message, ${formatDuration(note.duration_ms)}`}
        >
          <View style={styles.playerRow}>
            <View style={[styles.play, note.mine && styles.playMine]}>
              <Icon name={active && playback.playing ? 'pause' : 'play'} color={note.mine ? colors.accent : '#FFFFFF'} size={18} chip={false} />
            </View>
            <View style={styles.track}>
              <View style={[styles.trackFill, note.mine && styles.trackFillMine, { width: `${progress * 100}%` }]} />
            </View>
            <Text style={[styles.duration, note.mine && styles.onMine]}>
              {active ? formatDuration(playback.positionMs) : formatDuration(note.duration_ms)}
            </Text>
          </View>

          {status === 'pending' && <Text style={[styles.transcript, styles.dim, note.mine && styles.onMine]}>Transcribing…</Text>}
          {status === 'done' && note.transcript ? (
            <Text style={[styles.transcript, note.mine && styles.onMine]}>{note.transcript}</Text>
          ) : null}
          {status === 'failed' && (
            <Pressable onPress={() => retryTranscript(note)}>
              <Text style={[styles.link, note.mine && styles.onMine]}>Couldn’t transcribe — try again</Text>
            </Pressable>
          )}
          {translation ? (
            <Text style={[styles.translation, note.mine && styles.onMine]}>{translation}</Text>
          ) : translateOn && note.transcript && !note.mine ? (
            <Pressable onPress={() => translateNote(note)} disabled={translating[note.id]}>
              <Text style={styles.link}>
                {translating[note.id] ? 'Translating…' : `Translate into ${languages[readIn] || readIn}`}
              </Text>
            </Pressable>
          ) : null}

          <Text style={[styles.meta, note.mine && styles.onMine]}>
            {timeOf(note.created_at)}
            {note.filter ? ` · ${filters[note.filter] || note.filter}` : ''}
            {note.mine ? (note.listened_at ? ' · Heard' : ' · Sent') : ''}
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.list}
      data={notes}
      keyExtractor={(n) => n.id}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListEmptyComponent={loading
        ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
        : <Text style={[styles.muted, styles.empty]}>No voice messages yet. Hold the mic to send the first one.</Text>}
    />
  );
}

const makeStyles = (colors, font) => StyleSheet.create({
  list: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  header: { gap: spacing.md, marginBottom: spacing.md },
  tip: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  tipText: { ...font.muted, flex: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { ...font.body, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { ...font.body, flex: 1 },
  muted: { ...font.muted },
  aiNote: { paddingHorizontal: spacing.xs },
  dim: { opacity: 0.55 },
  chips: { gap: spacing.sm, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...font.muted, fontWeight: '700', color: colors.textPrimary },
  chipTextActive: { color: '#FFFFFF' },
  empty: { textAlign: 'center', marginTop: spacing.lg },
  noteRow: { flexDirection: 'row' },
  mineRow: { justifyContent: 'flex-end' },
  theirsRow: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '86%', minWidth: 220, borderRadius: radius.lg, padding: spacing.sm + 2, gap: 6 },
  mine: { backgroundColor: colors.accent },
  theirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.glassBorder },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  play: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  playMine: { backgroundColor: '#FFFFFF' },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.accentSoft, overflow: 'hidden' },
  trackFill: { height: 4, backgroundColor: colors.accent },
  trackFillMine: { backgroundColor: '#FFFFFF' },
  duration: { ...font.muted, fontVariant: ['tabular-nums'], fontWeight: '700' },
  transcript: { ...font.body },
  translation: { ...font.body, fontStyle: 'italic' },
  link: { ...font.muted, fontWeight: '700', color: colors.accent, textDecorationLine: 'underline' },
  meta: { ...font.muted, fontSize: 11 },
  onMine: { color: '#FFFFFF' },
});
