// Fable: the group chat between the two of you and an AI model.
//
// The model, the keys and the messages all live on our own server
// (backend/src/routes/fable.js); this screen only ever talks to it. You each
// post under your own name and the AI answers under the name you gave it —
// to every message, or only when named, as set on the setup page
// (FableSetupScreen).
//
// New messages arrive over the socket the rest of the app already uses; a
// slow poll while the screen is open covers the moments the socket is down.
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, isUnpaired, connectSocket } from '../services/api';
import NotPaired from '../components/NotPaired';
import { spacing, radius } from '../theme';
import { useBarClearance } from '../components/LumaBar';
import { MorphButton, PulsingText } from '../components/Motion';
import Icon from '../components/Icon';
import { useTheme } from '../components/ThemeContext';
import Icon3D from '../components/Icon3D';

const POLL_MS = 10000;

/** Adds messages without duplicates, in id order. */
export function mergeFeed(list, incoming) {
  if (!incoming?.length) return list;
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

const timeOf = (m) => {
  const date = new Date(m.createdAt);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export default function FableScreen({ navigation }) {
  const { colors, font } = useTheme();
  // A screen of its own above the tabs (App.js), so there is no bottom bar
  // to clear: just the phone's own navigation.
  const clearance = useBarClearance({ barHidden: true });
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [messages, setMessages] = useState([]);
  const [info, setInfo] = useState(null);          // null while loading
  const [thinking, setThinking] = useState(false);
  const [partnerName, setPartnerName] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState(null);
  const [unpaired, setUnpaired] = useState(false);
  const lastId = useRef(0);
  const listRef = useRef(null);

  const pull = useCallback(async ({ full = false } = {}) => {
    try {
      const d = await apiFetch(`/fable/messages${full ? '' : `?since=${lastId.current}`}`);
      if (full) setMessages(d.messages || []);
      else setMessages((list) => mergeFeed(list, d.messages));
      const newest = d.messages?.length ? d.messages[d.messages.length - 1].id : 0;
      if (full) lastId.current = newest;
      else if (newest > lastId.current) lastId.current = newest;
      setInfo({ ready: d.ready, problem: d.problem, botName: d.botName || 'Fable', replyMode: d.replyMode });
      setThinking(Boolean(d.thinking));
      setProblem(null);
    } catch (err) {
      if (isUnpaired(err)) { setUnpaired(true); return; }
      setProblem(err.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      let socketRef = null;
      apiFetch('/profile').then((d) => live && setPartnerName(d?.partner?.displayName || null)).catch(() => {});
      pull({ full: true });

      const onMessage = () => pull();
      const onThinking = ({ thinking: t }) => setThinking(Boolean(t));
      const onCleared = () => { lastId.current = 0; setMessages([]); };
      connectSocket().then((socket) => {
        if (!live || !socket) return;
        socketRef = socket;
        socket.on('fable:message', onMessage);
        socket.on('fable:thinking', onThinking);
        socket.on('fable:cleared', onCleared);
      }).catch(() => {});

      const timer = setInterval(() => pull(), POLL_MS);
      return () => {
        live = false;
        clearInterval(timer);
        socketRef?.off('fable:message', onMessage);
        socketRef?.off('fable:thinking', onThinking);
        socketRef?.off('fable:cleared', onCleared);
      };
    }, [pull])
  );

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const d = await apiFetch('/fable/messages', { method: 'POST', body: { body } });
      setDraft('');
      setMessages((list) => mergeFeed(list, [d.message]));
      if (d.message.id > lastId.current) lastId.current = d.message.id;
      if (d.aiReplying) setThinking(true);
    } catch (err) {
      setProblem(err.message);
    } finally {
      setSending(false);
    }
  };

  const botName = info?.botName || 'Fable';
  const openSetup = useCallback(() => navigation.navigate('FableSetup'), [navigation]);

  // The AI's name in the title, and the setup gear beside it.
  useLayoutEffect(() => {
    navigation.setOptions?.({
      title: botName,
      headerRight: () => (
        <MorphButton onPress={openSetup} style={styles.gear} accessibilityLabel="Set up the AI">
          <Icon name="settings-outline" chip={false} size={18} color={colors.text} />
        </MorphButton>
      ),
    });
  }, [navigation, botName, openSetup, styles.gear, colors.text]);

  if (unpaired) return <NotPaired navigation={navigation} what="Fable" />;
  const mentionOnly = info?.replyMode === 'mention';

  const renderItem = ({ item }) => {
    if (item.authorKind === 'system') {
      return (
        <Pressable onPress={openSetup} style={styles.systemRow}>
          <Icon name="alert-circle-outline" chip={false} size={13} color={colors.danger} />
          <Text style={styles.system}>{item.body}</Text>
        </Pressable>
      );
    }
    const mine = item.mine;
    const ai = item.authorKind === 'ai';
    return (
      <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
        <View style={[styles.bubble, mine ? styles.mine : ai ? styles.ai : styles.theirs]}>
          {!mine && (
            <View style={styles.authorRow}>
              <Icon name={ai ? 'sparkles' : 'heart'} chip={false} size={11} color={ai ? colors.accent : colors.textMuted} />
              <Text style={[styles.author, ai && { color: colors.accent }]}>{item.author}</Text>
            </View>
          )}
          <Text selectable style={[font.body, mine && styles.mineText]}>{item.body}</Text>
          <Text style={[styles.time, mine && styles.mineTime]}>{timeOf(item)}</Text>
        </View>
      </View>
    );
  };

  const notReady = info && !info.ready;

  return (
    <View style={styles.container}>
      <Text style={styles.subtitle}>You, {partnerName || 'your partner'} and {botName}</Text>

      {notReady ? (
        <View style={styles.card}>
          <Icon3D name="robot" size={56} />
          <Text style={[font.body, { fontWeight: '700', textAlign: 'center' }]}>
            {info.problem ? `${botName} needs a hand` : 'Add an AI to your chat'}
          </Text>
          <Text style={[font.muted, { textAlign: 'center' }]}>
            {info.problem || 'Pick a model and paste an API key. Google Gemini and Groq both have free keys.'}
          </Text>
          <MorphButton onPress={openSetup} style={styles.setupButton}>
            <Icon name="key-outline" chip={false} size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700' }}>Set up the AI</Text>
          </MorphButton>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={renderItem}
        ListEmptyComponent={
          info && info.ready ? (
            <View style={styles.emptyRow}>
              <Icon3D name="sparkles" size={48} />
              <Text style={[font.muted, { textAlign: 'center' }]}>
                {mentionOnly
                  ? `Chat away. Say @${botName} when you want it to join in.`
                  : `Ask ${botName} anything: a date idea, a film to watch, who is right.`}
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={thinking ? (
          <PulsingText style={styles.thinking}>{botName} is typing…</PulsingText>
        ) : null}
      />

      {problem ? (
        <Pressable onPress={() => pull()}><Text style={styles.problem}>{problem} Tap to retry.</Text></Pressable>
      ) : null}

      {mentionOnly && info?.ready && !draft.includes(`@${botName}`) ? (
        <MorphButton onPress={() => setDraft((d) => `@${botName} ${d}`.trimEnd() + (d ? '' : ' '))} style={styles.mentionChip}>
          <Icon name="sparkles" chip={false} size={12} color={colors.accent} />
          <Text style={{ color: colors.accent, fontWeight: '600', fontSize: 12 }}>@{botName}</Text>
        </MorphButton>
      ) : null}

      <View style={[styles.inputBar, { marginBottom: clearance.above }]}>
        <TextInput
          placeholder={mentionOnly ? `Message… @${botName} to ask it` : `Message ${partnerName || 'your partner'} and ${botName}…`}
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          style={styles.input}
          multiline
          maxLength={4000}
        />
        <Pressable onPress={send} disabled={!draft.trim() || sending}>
          <View style={[styles.sendButton, (!draft.trim() || sending) && styles.sendDisabled]}>
            <Icon name="send" chip={false} color="#fff" size={18} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    subtitle: { color: colors.textMuted, fontSize: 12, textAlign: 'center', paddingTop: spacing.sm },
    gear: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    listContent: { padding: spacing.lg, paddingBottom: 100 },

    systemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginVertical: spacing.xs, paddingHorizontal: spacing.md },
    system: { color: colors.danger, fontSize: 11, textAlign: 'center', flexShrink: 1 },

    row: { flexDirection: 'row', marginBottom: spacing.xs },
    rowMine: { justifyContent: 'flex-end' },
    rowTheirs: { justifyContent: 'flex-start' },
    bubble: {
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      maxWidth: '82%', minWidth: 64,
    },
    theirs: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderBottomLeftRadius: radius.sm,
    },
    // The AI gets the accent as an outline rather than a fill: clearly not a
    // person, and never mistaken for your own (filled) bubbles.
    ai: {
      backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.accent,
      borderBottomLeftRadius: radius.sm,
    },
    mine: { backgroundColor: colors.accent, borderBottomRightRadius: radius.sm },
    mineText: { color: '#fff' },
    authorRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
    author: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
    time: { fontSize: 10, color: colors.textMuted, alignSelf: 'flex-end', marginTop: 2 },
    mineTime: { color: 'rgba(255,255,255,0.75)' },
    thinking: { color: colors.accent, fontSize: 12, fontWeight: '600', marginTop: spacing.xs },

    card: {
      margin: spacing.lg, marginBottom: 0, padding: spacing.lg, gap: spacing.sm, alignItems: 'center',
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    },
    setupButton: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs,
      backgroundColor: colors.accent, borderRadius: radius.pill,
      paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    },
    problem: { color: colors.danger, fontSize: 12, textAlign: 'center', paddingHorizontal: spacing.lg },
    emptyRow: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
    mentionChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
      marginLeft: spacing.md, paddingVertical: 4, paddingHorizontal: spacing.sm,
      borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    },

    inputBar: {
      flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, padding: spacing.md,
      borderTopWidth: 1, borderTopColor: colors.border,
    },
    input: {
      flex: 1, backgroundColor: colors.surface, color: colors.text,
      borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderWidth: 1, borderColor: colors.border, maxHeight: 120,
    },
    sendButton: {
      backgroundColor: colors.accent, borderRadius: radius.icon,
      width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    },
    sendDisabled: { opacity: 0.4 },
  });
