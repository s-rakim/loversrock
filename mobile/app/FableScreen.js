// Fable: the group chat between the two of you and your AI agents.
//
// The room itself is collaboration-des-esprits, running on the server PC; the
// backend relays to it (backend/src/routes/fable.js), so this screen only
// ever talks to our own server. You each post under your own name, the
// agents post as themselves, and @name tags one of them.
//
// New messages arrive by polling every few seconds while the screen is open.
// The room polls its own database the same way, and a chat you are looking at
// is the only time it matters.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, isUnpaired } from '../services/api';
import NotPaired from '../components/NotPaired';
import { spacing, radius } from '../theme';
import { useBarClearance } from '../components/LumaBar';
import { MorphButton } from '../components/Motion';
import Icon from '../components/Icon';
import { useTheme } from '../components/ThemeContext';
import ChatSwitcher from '../components/ChatSwitcher';
import Icon3D from '../components/Icon3D';

const POLL_MS = 3000;

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

/** Structured posts (a proposal, a decision…) are labelled; plain talk is not. */
const kindLabel = (kind) => (kind && kind !== 'message' && kind !== 'system' ? kind.replace(/_/g, ' ') : null);

export default function FableScreen({ navigation }) {
  const { colors, font } = useTheme();
  const clearance = useBarClearance();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);      // null while checking
  const [agents, setAgents] = useState(0);
  const [partnerName, setPartnerName] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState(null);
  const [unpaired, setUnpaired] = useState(false);
  const head = useRef(0);
  const listRef = useRef(null);

  const pull = useCallback(async () => {
    try {
      const d = await apiFetch(`/fable/feed?since=${head.current}`);
      head.current = d.head ?? head.current;
      setMessages((list) => mergeFeed(list, d.messages));
      setProblem(null);
    } catch (err) {
      if (isUnpaired(err)) { setUnpaired(true); return; }
      setProblem(err.message);
    }
  }, []);

  const checkRoom = useCallback(async () => {
    try {
      const s = await apiFetch('/fable/status');
      setStatus(s);
      if (s.configured && s.reachable) {
        apiFetch('/fable/roster')
          .then((r) => setAgents((r.members || []).filter((m) => m.kind === 'agent').length))
          .catch(() => {});
      }
      return s;
    } catch (err) {
      if (isUnpaired(err)) setUnpaired(true);
      else setStatus({ configured: true, reachable: false, error: err.message });
      return null;
    }
  }, []);

  // Open: check the room, load everything, then keep up while visible.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      let timer = null;
      apiFetch('/profile').then((d) => setPartnerName(d?.partner?.displayName || null)).catch(() => {});
      (async () => {
        const s = await checkRoom();
        if (!live || !s?.reachable) return;
        await pull();
        const tick = async () => {
          if (!live) return;
          await pull();
          if (live) timer = setTimeout(tick, POLL_MS);
        };
        timer = setTimeout(tick, POLL_MS);
      })();
      return () => { live = false; clearTimeout(timer); };
    }, [checkRoom, pull])
  );

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await apiFetch('/fable/messages', { method: 'POST', body: { body } });
      setDraft('');
      await pull();
    } catch (err) {
      setProblem(err.message);
    } finally {
      setSending(false);
    }
  };

  const retry = async () => {
    setProblem(null);
    const s = await checkRoom();
    if (s?.reachable) pull();
  };

  if (unpaired) return <NotPaired navigation={navigation} what="Fable" />;

  const subtitle = `You, ${partnerName || 'your partner'}${agents ? ` and ${agents} AI agent${agents === 1 ? '' : 's'}` : ' and your AI agents'}`;

  const renderItem = ({ item }) => {
    if (item.authorKind === 'system') {
      return <Text style={styles.system}>{item.body}</Text>;
    }
    const mine = item.mine;
    const agent = item.authorKind === 'agent';
    const label = kindLabel(item.kind);
    return (
      <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
        <View style={[styles.bubble, mine ? styles.mine : agent ? styles.agent : styles.theirs]}>
          {!mine && (
            <View style={styles.authorRow}>
              <Icon name={agent ? 'sparkles' : 'person'} chip={false} size={11} color={agent ? colors.accent : colors.textMuted} />
              <Text style={[styles.author, agent && { color: colors.accent }]}>{item.author}</Text>
            </View>
          )}
          {(label || item.idea) && (
            <Text style={[styles.meta, mine && styles.mineMeta]}>
              {[label, item.idea && `#${item.idea}`].filter(Boolean).join(' · ')}
            </Text>
          )}
          <Text style={[font.body, mine && styles.mineText]}>{item.body}</Text>
          <Text style={[styles.time, mine && styles.mineTime]}>{timeOf(item)}</Text>
        </View>
      </View>
    );
  };

  const offline = status && (!status.configured || !status.reachable);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={font.h2}>Fable</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      <ChatSwitcher partnerName={partnerName} current="fable" navigation={navigation} />

      {offline ? (
        <View style={styles.card}>
          <Icon3D name="cloud" size={56} />
          <Text style={[font.body, { fontWeight: '700' }]}>
            {status.configured ? 'Fable\'s room is not answering' : 'Fable is not set up yet'}
          </Text>
          <Text style={[font.muted, { textAlign: 'center' }]}>
            {status.configured
              ? status.error
              : 'Start collaboration-des-esprits on the server PC and set ESPRITS_URL in backend/.env (docs/FABLE.md).'}
          </Text>
          <MorphButton onPress={retry} style={styles.retry}>
            <Icon name="refresh-outline" chip={false} size={16} color={colors.accent} />
            <Text style={{ color: colors.accent, fontWeight: '600' }}>Try again</Text>
          </MorphButton>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={renderItem}
          ListEmptyComponent={
            status ? (
              <View style={styles.emptyRow}>
                <Icon3D name="robot" size={56} />
                <Text style={font.muted}>Say hello to the room. @name tags an agent.</Text>
              </View>
            ) : null
          }
        />
      )}

      {problem && !offline ? (
        <Pressable onPress={retry}><Text style={styles.problem}>{problem} Tap to retry.</Text></Pressable>
      ) : null}

      <View style={[styles.inputBar, { marginBottom: clearance.above }]}>
        <TextInput
          placeholder="Message the room… @name tags an agent"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          style={styles.input}
          multiline
          editable={!offline}
        />
        <Pressable onPress={send} disabled={!draft.trim() || sending || Boolean(offline)}>
          <View style={[styles.sendButton, (!draft.trim() || sending || offline) && styles.sendDisabled]}>
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
    header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
    subtitle: { color: colors.textMuted, fontSize: 12, marginTop: -2 },
    listContent: { padding: spacing.lg, paddingBottom: 100 },

    system: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginVertical: spacing.xs },

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
    // Agents get the accent as an outline rather than a fill: clearly not a
    // person, and never mistaken for your own (filled) bubbles.
    agent: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent,
      borderBottomLeftRadius: radius.sm,
    },
    mine: { backgroundColor: colors.accent, borderBottomRightRadius: radius.sm },
    mineText: { color: '#fff' },
    authorRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
    author: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
    meta: { fontSize: 10, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', marginBottom: 2 },
    mineMeta: { color: 'rgba(255,255,255,0.8)' },
    time: { fontSize: 10, color: colors.textMuted, alignSelf: 'flex-end', marginTop: 2 },
    mineTime: { color: 'rgba(255,255,255,0.75)' },

    card: {
      margin: spacing.lg, padding: spacing.lg, gap: spacing.sm, alignItems: 'center',
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    },
    retry: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs,
      backgroundColor: colors.accentSoft, borderRadius: radius.pill,
      paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    },
    problem: { color: colors.danger, fontSize: 12, textAlign: 'center', paddingHorizontal: spacing.lg },
    emptyRow: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },

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
