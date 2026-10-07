// The AI room: Collaboration des Esprits (github.com/s-rakim/collaboration-
// des-esprits), which replaced Fable.
//
// A group chat with the two of you and every model seated in the room. Say
// something and every model answers; @name asks one. The models come through
// Free Claude Code on the PC, picked in its admin page; nothing about models
// or keys is set in this app.
//
// This screen only ever talks to our own backend (/esprits), which signs you
// in to the room under your own name. The room's full pages (setup, the
// board, swarm work, artifacts) open in the browser from the globe button.
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, FlatList, Pressable, Linking, Modal, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, isUnpaired, connectSocket } from '../services/api';
import { setActiveScreen } from '../services/notifications';
import NotPaired from '../components/NotPaired';
import { spacing, radius } from '../theme';
import { useBarClearance } from '../components/LumaBar';
import { MorphButton, PulsingText } from '../components/Motion';
import Icon from '../components/Icon';
import { useTheme } from '../components/ThemeContext';
import Icon3D from '../components/Icon3D';

// The room answers quickly; a reply is a few seconds of a model thinking.
const FEED_MS = 2500;
const STATUS_MS = 10000;

/** Adds messages without duplicates, in id order. */
export function mergeFeed(list, incoming) {
  if (!incoming?.length) return list;
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** The words for a message that is not a plain message: a question, a proposal… */
export const KIND_LABELS = {
  question: 'Question', answer: 'Answer', proposal: 'Proposal', decision: 'Decision',
  objection: 'Objection', score: 'Score', handoff: 'Handoff', spec: 'Spec', artifact: 'Artifact',
};

/** Puts @seat at the front of a draft (or swaps the one already there). */
export function mentionIn(draft, seat) {
  const rest = String(draft || '').replace(/^@\S+\s*/, '');
  return `@${seat} ${rest}`;
}

const timeOf = (m) => {
  const date = new Date(m.createdAt);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export default function EspritsScreen({ navigation }) {
  const { colors, font } = useTheme();
  const clearance = useBarClearance({ barHidden: true });
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);       // null while loading
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState(null);
  const [unpaired, setUnpaired] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [elsewhere, setElsewhere] = useState(false);
  const [fccAddress, setFccAddress] = useState('');
  const [fccToken, setFccToken] = useState('');
  const [ideaOpen, setIdeaOpen] = useState(false);
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaText, setIdeaText] = useState('');
  const head = useRef(null);
  const listRef = useRef(null);
  const atBottom = useRef(true);

  const pull = useCallback(async () => {
    try {
      const first = head.current === null;
      const d = await apiFetch(`/esprits/feed${first ? '' : `?since=${head.current}`}`);
      setMessages((list) => (first ? d.messages || [] : mergeFeed(list, d.messages)));
      head.current = Number(d.head ?? head.current ?? 0);
      setProblem(null);
      // A capped page: fetch the rest straight away.
      if (d.more) pull();
    } catch (err) {
      if (isUnpaired(err)) { setUnpaired(true); return; }
      setProblem(err.message);
    }
  }, []);

  const check = useCallback(async () => {
    try {
      setStatus(await apiFetch('/esprits/status'));
    } catch (err) {
      if (isUnpaired(err)) { setUnpaired(true); return; }
      setStatus({ ready: false, reachable: false, problem: err.message });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      let socketRef = null;
      setActiveScreen('Esprits');
      head.current = null;
      check();
      pull();
      const onNew = () => { if (live) pull(); };
      connectSocket().then((socket) => {
        if (!live || !socket) return;
        socketRef = socket;
        socket.on('esprits:new', onNew);
      }).catch(() => {});
      const feedTimer = setInterval(pull, FEED_MS);
      const statusTimer = setInterval(check, STATUS_MS);
      return () => {
        live = false;
        setActiveScreen(null);
        clearInterval(feedTimer);
        clearInterval(statusTimer);
        socketRef?.off('esprits:new', onNew);
      };
    }, [pull, check])
  );

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await apiFetch('/esprits/post', { method: 'POST', body: { body } });
      setDraft('');
      atBottom.current = true;
      pull();
      check();
    } catch (err) {
      setProblem(err.message);
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    try { await apiFetch('/esprits/stop', { method: 'POST' }); } catch (err) { setProblem(err.message); }
    check();
  };

  const connect = async () => {
    setConnecting(true);
    try {
      const body = elsewhere
        ? { ...(fccAddress.trim() ? { baseURL: fccAddress.trim() } : {}), ...(fccToken.trim() ? { token: fccToken.trim() } : {}) }
        : {};
      const d = await apiFetch('/esprits/connect', { method: 'POST', body });
      if (d?.ok === false) throw new Error(d.error || 'Could not connect');
      setFccToken('');
      await check();
    } catch (err) {
      Alert.alert('Free Claude Code', err.message);
    } finally {
      setConnecting(false);
    }
  };

  const dropIdea = async () => {
    const title = ideaTitle.trim();
    if (!title) return;
    try {
      await apiFetch('/esprits/ideas', { method: 'POST', body: { title, raw: ideaText.trim() } });
      setIdeaOpen(false);
      setIdeaTitle('');
      setIdeaText('');
      pull();
    } catch (err) {
      Alert.alert('Could not drop the idea', err.message);
    }
  };

  const openRoom = useCallback(() => {
    if (!status?.webUrl) {
      Alert.alert('The full room', 'The server did not say where the room\'s pages are.');
      return;
    }
    Linking.openURL(status.webUrl).catch(() => Alert.alert('Could not open', status.webUrl));
  }, [status?.webUrl]);

  useLayoutEffect(() => {
    navigation.setOptions?.({
      title: 'Esprits',
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          <MorphButton onPress={() => setIdeaOpen(true)} style={styles.headerButton} accessibilityLabel="Drop an idea">
            <Icon name="bulb-outline" chip={false} size={20} color={colors.text} />
          </MorphButton>
          <MorphButton onPress={openRoom} style={styles.headerButton} accessibilityLabel="Open the full room in the browser">
            <Icon name="globe-outline" chip={false} size={20} color={colors.text} />
          </MorphButton>
        </View>
      ),
    });
  }, [navigation, openRoom, styles.headerButton, colors.text]);

  if (unpaired) return <NotPaired navigation={navigation} what="Esprits" />;

  const seats = (status?.seats || []).filter((s) => s.enabled);
  const busy = status?.busy || [];

  const renderItem = ({ item }) => {
    if (item.authorKind === 'system' || item.kind === 'system') {
      return <Text style={styles.system}>{item.body}</Text>;
    }
    const mine = item.mine;
    const agent = item.authorKind === 'agent';
    const label = KIND_LABELS[item.kind];
    return (
      <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
        <View style={[styles.bubble, mine ? styles.mine : agent ? styles.agent : styles.theirs]}>
          {!mine && (
            <View style={styles.authorRow}>
              <Icon name={agent ? 'sparkles' : 'heart'} chip={false} size={11} color={agent ? colors.accent : colors.textMuted} />
              <Text style={[styles.author, agent && { color: colors.accent }]}>{item.name || item.author}</Text>
            </View>
          )}
          {label || item.idea ? (
            <Text style={[styles.tag, mine && { color: 'rgba(255,255,255,0.85)' }]}>
              {[label, item.idea ? `#${item.idea}` : null].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          <Text selectable style={[font.body, mine && styles.mineText]}>{item.body}</Text>
          <Text style={[styles.time, mine && styles.mineTime]}>{timeOf(item)}</Text>
        </View>
      </View>
    );
  };

  const fcc = status?.fcc;
  const chip = !status ? null : status.reachable === false
    ? { text: 'Room offline', color: colors.danger }
    : fcc?.running
      ? { text: `FCC · ${fcc.model || 'connected'}`, color: colors.success }
      : { text: 'Free Claude Code not running', color: colors.danger };

  return (
    <View style={styles.container}>
      <Pressable onPress={check} style={styles.statusRow} accessibilityLabel="Check the room again">
        {chip ? (
          <View style={[styles.chip, { borderColor: chip.color }]}>
            <View style={[styles.dot, { backgroundColor: chip.color }]} />
            <Text style={{ color: chip.color, fontSize: 12, fontWeight: '600' }}>{chip.text}</Text>
          </View>
        ) : null}
        <Text style={styles.subtitle}>
          {seats.length ? `With ${seats.map((s) => s.name).join(', ')}` : 'You, your partner and your models'}
        </Text>
      </Pressable>

      {status && !status.ready ? (
        <View style={styles.card}>
          <Icon3D name="robot" size={52} />
          <Text style={[font.body, { fontWeight: '700', textAlign: 'center' }]}>
            {status.reachable === false ? 'The room is not answering' : 'Connect your models'}
          </Text>
          <Text style={[font.muted, { textAlign: 'center' }]}>{status.problem}</Text>
          {status.reachable !== false ? (
            <>
              {elsewhere ? (
                <View style={{ alignSelf: 'stretch', gap: spacing.xs }}>
                  <TextInput value={fccAddress} onChangeText={setFccAddress} placeholder="http://host.docker.internal:8082/v1"
                    placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} style={styles.field} />
                  <TextInput value={fccToken} onChangeText={setFccToken} placeholder="FCC proxy token (only if it is on)"
                    placeholderTextColor={colors.textMuted} autoCapitalize="none" secureTextEntry style={styles.field} />
                </View>
              ) : null}
              <MorphButton onPress={connect} style={styles.primary} disabled={connecting}>
                <Icon name="link-outline" chip={false} size={16} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700' }}>{connecting ? 'Connecting…' : 'Connect Free Claude Code'}</Text>
              </MorphButton>
              <Pressable onPress={() => setElsewhere((v) => !v)}>
                <Text style={{ color: colors.accent, fontSize: 12 }}>{elsewhere ? 'Use the usual address' : 'It is somewhere else'}</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => String(item.id)}
        style={styles.column}
        contentContainerStyle={styles.listContent}
        onScroll={({ nativeEvent: e }) => {
          atBottom.current = e.contentSize.height - (e.contentOffset.y + e.layoutMeasurement.height) < 120;
        }}
        scrollEventThrottle={100}
        onContentSizeChange={() => { if (atBottom.current) listRef.current?.scrollToEnd({ animated: true }); }}
        renderItem={renderItem}
        ListEmptyComponent={status?.ready ? (
          <View style={styles.emptyRow}>
            <Icon3D name="sparkles" size={48} />
            <Text style={[font.muted, { textAlign: 'center' }]}>
              Ask anything and every model answers. Start with @ and a name to ask just one.
            </Text>
          </View>
        ) : null}
        ListFooterComponent={busy.length ? (
          <View style={styles.busyRow}>
            <PulsingText style={styles.thinking}>{busy.join(', ')} {busy.length === 1 ? 'is' : 'are'} replying…</PulsingText>
            <MorphButton onPress={stop} style={styles.stop} accessibilityLabel="Stop the replies">
              <Icon name="stop" chip={false} size={12} color={colors.danger} />
              <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>Stop</Text>
            </MorphButton>
          </View>
        ) : null}
      />

      {problem ? (
        <Pressable onPress={() => { pull(); check(); }}><Text style={styles.problem}>{problem} Tap to retry.</Text></Pressable>
      ) : null}

      {seats.length ? (
        <View style={[styles.column, styles.seatRow]}>
          {seats.map((s) => (
            <Pressable key={s.name} onPress={() => setDraft((d) => mentionIn(d, s.name))} style={styles.seatChip}
              accessibilityLabel={`Ask ${s.name}`}>
              <Icon name="sparkles" chip={false} size={11} color={colors.accent} />
              <Text style={{ color: colors.accent, fontWeight: '600', fontSize: 12 }}>@{s.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={[styles.column, styles.inputBar, { marginBottom: clearance.above }]}>
        <TextInput
          placeholder="Say something to the room…"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          style={styles.input}
          multiline
          maxLength={8000}
        />
        <Pressable onPress={send} disabled={!draft.trim() || sending} accessibilityLabel="Send">
          <View style={[styles.sendButton, (!draft.trim() || sending) && styles.sendDisabled]}>
            <Icon name="send" chip={false} color="#fff" size={18} />
          </View>
        </Pressable>
      </View>

      <Modal visible={ideaOpen} transparent animationType="fade" onRequestClose={() => setIdeaOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.scrim}>
          <View style={[styles.ideaCard, { backgroundColor: colors.surface }]}>
            <Text style={font.h2}>Drop an idea</Text>
            <Text style={[font.muted, { marginTop: spacing.xs }]}>
              The models ask what they need, propose ways to do it and score each other; you choose.
            </Text>
            <TextInput value={ideaTitle} onChangeText={setIdeaTitle} placeholder="What is it?" maxLength={200}
              placeholderTextColor={colors.textMuted} style={[styles.field, { marginTop: spacing.md }]} />
            <TextInput value={ideaText} onChangeText={setIdeaText} placeholder="As much or as little as you have…" multiline
              placeholderTextColor={colors.textMuted} style={[styles.field, { minHeight: 100, marginTop: spacing.sm, textAlignVertical: 'top' }]} />
            <View style={styles.ideaButtons}>
              <Pressable onPress={() => setIdeaOpen(false)} style={{ padding: spacing.sm }}><Text style={font.body}>Cancel</Text></Pressable>
              <MorphButton onPress={dropIdea} style={[styles.primary, !ideaTitle.trim() && { opacity: 0.4 }]} disabled={!ideaTitle.trim()}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Drop it</Text>
              </MorphButton>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    column: { width: '100%', maxWidth: 860, alignSelf: 'center' },
    headerButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    statusRow: { alignItems: 'center', paddingTop: spacing.sm, gap: 4 },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.pill,
      paddingHorizontal: spacing.sm, paddingVertical: 2, backgroundColor: colors.surface,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    subtitle: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
    listContent: { padding: spacing.lg, paddingBottom: 60 },

    system: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginVertical: spacing.xs },
    row: { flexDirection: 'row', marginBottom: spacing.xs },
    rowMine: { justifyContent: 'flex-end' },
    rowTheirs: { justifyContent: 'flex-start' },
    bubble: { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, maxWidth: '86%', minWidth: 64 },
    theirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: radius.sm },
    // A model gets the accent as an outline rather than a fill: clearly not a
    // person, and never mistaken for your own (filled) bubbles.
    agent: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.accent, borderBottomLeftRadius: radius.sm },
    mine: { backgroundColor: colors.accent, borderBottomRightRadius: radius.sm },
    mineText: { color: '#fff' },
    authorRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
    author: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
    tag: { fontSize: 10, fontWeight: '700', color: colors.accent, textTransform: 'uppercase', marginBottom: 2 },
    time: { fontSize: 10, color: colors.textMuted, alignSelf: 'flex-end', marginTop: 2 },
    mineTime: { color: 'rgba(255,255,255,0.75)' },
    busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
    thinking: { color: colors.accent, fontSize: 12, fontWeight: '600' },
    stop: {
      flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.danger,
      borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2,
    },

    card: {
      margin: spacing.lg, marginBottom: 0, padding: spacing.lg, gap: spacing.sm, alignItems: 'center',
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
      width: '100%', maxWidth: 560, alignSelf: 'center',
    },
    primary: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs,
      backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    },
    field: {
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, color: colors.text,
      backgroundColor: colors.background, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    },
    problem: { color: colors.danger, fontSize: 12, textAlign: 'center', paddingHorizontal: spacing.lg },
    emptyRow: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
    seatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.md },
    seatChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: spacing.sm,
      borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    },
    inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
    input: {
      flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: radius.pill,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, maxHeight: 140,
    },
    sendButton: { backgroundColor: colors.accent, borderRadius: radius.icon, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    sendDisabled: { opacity: 0.4 },
    scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.lg },
    ideaCard: { borderRadius: radius.lg || 20, padding: spacing.lg, width: '100%', maxWidth: 520, alignSelf: 'center' },
    ideaButtons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  });
