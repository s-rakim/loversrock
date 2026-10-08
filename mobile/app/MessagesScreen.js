// The message thread.
//
// What Nextcloud Talk's chat does, for two: hold a message to react, reply,
// copy, edit (for a day), pin, be reminded of it, or delete it; "typing…"
// and "Seen"; polls and shared places from the + menu; hold Send to send
// later or without a notification; search the thread; everything shared, by
// kind, one tap away; and the thread a page at a time.
//
// Two older lessons still hold here, and are worth naming:
//
//  * Every message reaches this screen twice (the POST response and the
//    socket echo), so messages are merged by id, never appended.
//  * Photos go through mediaUrl(), because /media is authenticated and an
//    <Image> cannot send a header.
//
// With encryption on, every body (texts, polls, places) is sealed before it
// leaves the phone; useDecrypted opens them, and nothing the server holds
// can be read by it. Search runs here, on the phone, for the same reason.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, FlatList, Alert, Pressable, BackHandler, AppState,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { apiFetch, connectSocket, getSocket, isUnpaired } from '../services/api';
import NotPaired from '../components/NotPaired';
import { spacing, radius } from '../theme';
import { useBarClearance } from '../components/LumaBar';
import { MorphButton } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import { useTheme } from '../components/ThemeContext';
import CallButtons from '../components/calls/CallButtons';
import { setActiveScreen } from '../services/notifications';
import Wallpaper from '../components/Wallpaper';
import { getKeyPair, encryptFor } from '../services/crypto';
import { checkPartnerKey } from '../services/keyTrust';
import Icon3D from '../components/Icon3D';
import MessageBubble from '../components/chat/MessageBubble';
import ChatSheet from '../components/chat/ChatSheet';
import PollComposer from '../components/chat/PollComposer';
import useDecrypted from '../components/chat/useDecrypted';
import {
  QUICK_REACTIONS, canEdit, canDelete, isScheduled, isDeleted, previewOf, lastSeenOwn,
  searchMatches, laterChoices, whenLabel,
} from '../components/chat/chatModel';

// A page of the thread; older pages load as you scroll up.
const PAGE = 60;
// "Typing…" is sent at most this often, and stops this long after the last key.
const TYPING_EVERY_MS = 2500;
const TYPING_IDLE_MS = 3500;
// And shown for this long after the last one heard, so a lost "stopped"
// cannot leave it on.
const TYPING_SHOWN_MS = 6000;

/**
 * Adds a message without ever adding it twice.
 *
 * The same message reaches this screen by two routes — the POST response and
 * the socket broadcast — and which arrives first is a race. Keyed by id, so
 * whichever loses is discarded rather than duplicated. A re-delivery with
 * newer fields (a seen_at, an edit) replaces the older copy in place.
 */
export function mergeMessage(list, message) {
  if (!message?.id) return list;
  const at = list.findIndex((m) => m.id === message.id);
  if (at === -1) return [...list, message];
  const next = list.slice();
  next[at] = { ...next[at], ...message };
  return next;
}

/** Older messages in front of the ones already here, by id, in time order. */
export function prependPage(list, older) {
  const have = new Set(list.map((m) => m.id));
  return [...older.filter((m) => !have.has(m.id)), ...list];
}

/** The thread in time order (a scheduled message sits at its send time). */
const byTime = (a, b) => new Date(a.sent_at) - new Date(b.sent_at);

/** True when enough time has passed that a date deserves restating. */
const startsNewDay = (message, previous) => {
  if (!previous) return true;
  const a = new Date(message.sent_at);
  const b = new Date(previous.sent_at);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return a.toDateString() !== b.toDateString();
};

const dayLabel = (message) => {
  const date = new Date(message.sent_at);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
};

const copyText = (text) => {
  try {
    // eslint-disable-next-line global-require
    require('react-native').Clipboard.setString(text);
    return true;
  } catch {
    return false;
  }
};

export default function MessagesScreen({ navigation, route }) {
  const { colors, font } = useTheme();
  // The chat takes the whole screen: the tab bar steps aside while it is open
  // (BAR_HIDDEN_ON in LumaBar), so the message box sits just above the
  // phone's own navigation, not above a bar that is not there.
  const clearance = useBarClearance({ barHidden: true });

  // Back from the chat is the camera, where the bottom bar is again — not
  // whichever section screen happened to be before it.
  const toCamera = useCallback(() => navigation.navigate('Camera'), [navigation]);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pinned, setPinned] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  // Who I am, so a bubble can be placed on the right side.
  const [meId, setMeId] = useState(null);
  const [partnerName, setPartnerName] = useState(null);
  const [wallpaper, setWallpaper] = useState('none');
  // Their public key, which is what outgoing messages are sealed to. Until it
  // arrives there is nobody to encrypt for, and the composer says so rather
  // than quietly sending in the clear.
  const [partnerKey, setPartnerKey] = useState(null);
  const [keyTrust, setKeyTrust] = useState(null);
  const { textOf, remember } = useDecrypted(messages, partnerKey);
  // Before pairing the server refuses this, correctly. That is a state, not
  // a failure, and it gets a screen rather than a dialog.
  const [unpaired, setUnpaired] = useState(false);

  // What the composer is doing besides writing: replying to, or editing.
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  // Sheets: a message's menu, the + menu, send-later, remind-me, the poll.
  const [menuFor, setMenuFor] = useState(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [laterFor, setLaterFor] = useState(null);   // { kind: 'send' | 'remind' | 'reschedule', message? }
  const [pollOpen, setPollOpen] = useState(false);
  // Search.
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [matchAt, setMatchAt] = useState(0);
  // "Typing…", and where the list is.
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [unreadBelow, setUnreadBelow] = useState(0);
  const atBottomRef = useRef(true);
  const focused = useRef(false);

  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (searching) { setSearching(false); setQuery(''); return true; }
      if (editing || replyTo) { setEditing(null); setReplyTo(null); setDraft(''); return true; }
      toCamera();
      return true;
    });
    return () => sub.remove();
  }, [toCamera, searching, editing, replyTo]));

  // ---- Loading ------------------------------------------------------------
  const markSeen = useCallback(() => {
    if (!focused.current || AppState.currentState !== 'active') return;
    apiFetch('/messages/seen', { method: 'POST' }).catch(() => {});
  }, []);

  const load = useCallback(() => {
    apiFetch(`/messages?limit=${PAGE}`)
      .then((d) => {
        setMessages((prev) => {
          // Keep older pages already loaded; refresh the newest.
          let next = prev.filter((m) => !d.messages.some((n) => n.id === m.id));
          next = [...next, ...d.messages].sort(byTime);
          return next;
        });
        setHasMore((h) => h || d.hasMore);
        setPinned(d.pinned || []);
        setUnpaired(false);
        markSeen();
      })
      .catch((err) => {
        if (isUnpaired(err)) { setUnpaired(true); return; }
        Alert.alert('Error', err.message);
      });
  }, [markSeen]);

  const loadOlder = useCallback(async () => {
    if (!hasMore || loadingOlder || !messages.length) return;
    setLoadingOlder(true);
    try {
      const d = await apiFetch(`/messages?limit=${PAGE}&before=${encodeURIComponent(messages[0].sent_at)}`);
      setMessages((prev) => prependPage(prev, d.messages));
      setHasMore(d.hasMore);
    } catch { /* tried again on the next scroll */ }
    setLoadingOlder(false);
  }, [hasMore, loadingOlder, messages]);

  /** Everything, for search and for jumping to an old message. */
  const loadAll = useCallback(async () => {
    if (!hasMore) return messages;
    const d = await apiFetch('/messages');
    const all = d.messages.sort(byTime);
    setMessages(all);
    setHasMore(false);
    return all;
  }, [hasMore, messages]);

  // One profile fetch covers all three: the wallpaper is a per-account
  // preference, and the ids are what make the thread legible.
  useFocusEffect(
    useCallback(() => {
      apiFetch('/profile')
        .then(async (d) => {
          setWallpaper(d?.me?.chatWallpaper || 'none');
          setMeId(d?.me?.id || null);
          setPartnerName(d?.partner?.displayName || null);
          setPartnerKey(d?.partner?.publicKey || null);
          // A key other than the one this phone first saw for them is not
          // used until you accept it (services/keyTrust.js).
          setKeyTrust(await checkPartnerKey(d?.partner?.id, d?.partner?.publicKey));

          // Publish our own key if the server does not have this device's
          // yet — a fresh install, or the first run after encryption shipped.
          const mine = await getKeyPair();
          if (d?.me?.publicKey !== mine.publicKeyBase64) {
            apiFetch('/profile/keys', { method: 'PUT', body: { publicKey: mine.publicKeyBase64 } })
              .catch(() => { /* retried on the next focus */ });
          }
        })
        .catch(() => {});
    }, [])
  );

  useFocusEffect(load);

  // Tells the notification handler the thread is open, so a push for the
  // message you are already looking at does not draw a banner over it.
  useFocusEffect(useCallback(() => {
    focused.current = true;
    setActiveScreen('Messages');
    return () => { focused.current = false; setActiveScreen(null); };
  }, []));

  // ---- Live: new, changed, seen, reactions, typing ----------------------
  useEffect(() => {
    let socketRef;
    let typingTimer = null;
    connectSocket().then((socket) => {
      socketRef = socket;
      socket.on('message:new', ({ message }) => {
        setMessages((prev) => mergeMessage(prev, message));
        if (message.sender_id !== meId) {
          setPartnerTyping(false);
          if (atBottomRef.current) markSeen();
          else setUnreadBelow((n) => n + 1);
        }
      });
      socket.on('message:updated', ({ message }) => {
        setMessages((prev) => mergeMessage(prev, message));
        setPinned((list) => {
          const rest = list.filter((m) => m.id !== message.id);
          return message.pinned_at && !message.deleted_at ? [message, ...rest] : rest;
        });
      });
      socket.on('message:seen', ({ ids, at }) => {
        const seen = new Set(ids || []);
        setMessages((prev) => prev.map((m) => (seen.has(m.id) ? { ...m, seen_at: at } : m)));
      });
      socket.on('reaction:changed', ({ targetKind, targetId, userId, emoji }) => {
        if (targetKind !== 'message') return;
        setMessages((prev) => prev.map((m) => {
          if (m.id !== targetId) return m;
          const others = (m.reactions || []).filter((r) => r.userId !== userId);
          return { ...m, reactions: emoji ? [...others, { userId, emoji }] : others };
        }));
      });
      socket.on('chat:typing', ({ typing }) => {
        clearTimeout(typingTimer);
        setPartnerTyping(Boolean(typing));
        if (typing) typingTimer = setTimeout(() => setPartnerTyping(false), TYPING_SHOWN_MS);
      });
    });
    return () => {
      clearTimeout(typingTimer);
      ['message:new', 'message:updated', 'message:seen', 'reaction:changed', 'chat:typing']
        .forEach((e) => socketRef?.off(e));
    };
  }, [meId, markSeen]);

  // Back in the app with the chat open: what arrived meanwhile is seen now.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') markSeen(); });
    return () => sub.remove();
  }, [markSeen]);

  // "Typing…" for the other phone: sent as you type, at most every few
  // seconds, and "stopped" shortly after the last key or on send.
  const typingSent = useRef(0);
  const typingStop = useRef(null);
  const tellTyping = useCallback((typing) => {
    getSocket()?.emit('chat:typing', { typing });
    typingSent.current = typing ? Date.now() : 0;
  }, []);
  const onDraft = useCallback((text) => {
    setDraft(text);
    if (editing) return;
    if (text && Date.now() - typingSent.current > TYPING_EVERY_MS) tellTyping(true);
    clearTimeout(typingStop.current);
    typingStop.current = setTimeout(() => { if (typingSent.current) tellTyping(false); }, TYPING_IDLE_MS);
  }, [editing, tellTyping]);

  // ---- Sending --------------------------------------------------------------
  /**
   * A body sealed for the partner when there is a key, plain when not. A key
   * that changed since this phone last trusted one is not used, and nothing
   * is sent in plain text instead: you accept it (or check it) first.
   */
  const seal = useCallback(async (plain) => {
    if (partnerKey && keyTrust?.status === 'changed') {
      throw new Error(`${partnerName || 'Your partner'}'s encryption key changed. Tap the warning above the message box to check it, then send again.`);
    }
    return partnerKey
      ? { content: await encryptFor(partnerKey, plain), encrypted: true }
      : { content: plain };
  }, [partnerKey, keyTrust, partnerName]);

  const post = useCallback(async (body, plain) => {
    const data = await apiFetch('/messages', { method: 'POST', body });
    // Our own copy is decrypted locally rather than round-tripped.
    if (body.encrypted) remember(data.message.content, plain);
    setMessages((prev) => mergeMessage(prev, data.message));
    return data.message;
  }, [remember]);

  async function sendText({ sendAt, silent } = {}) {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');          // cleared first: the keyboard should not wait on the network
    if (typingSent.current) tellTyping(false);
    setSending(true);
    const reply = replyTo;
    const edit = editing;
    setReplyTo(null);
    setEditing(null);
    try {
      // Encrypted when there is a key to encrypt to, plain when there is not.
      // The fallback is deliberate and visible — the composer says which is
      // happening — because silently downgrading to plaintext while still
      // showing a padlock is the worst thing this code could do.
      const sealed = await seal(text);
      if (edit) {
        const data = await apiFetch(`/messages/${edit.id}`, { method: 'PATCH', body: sealed });
        if (sealed.encrypted) remember(data.message.content, text);
        setMessages((prev) => mergeMessage(prev, data.message));
      } else {
        await post({
          type: 'text', ...sealed,
          ...(reply ? { replyToMessageId: reply.id } : {}),
          ...(sendAt ? { sendAt } : {}),
          ...(silent ? { silent: true } : {}),
        }, text);
        atBottomRef.current = true;
      }
    } catch (err) {
      setDraft(text);      // put it back rather than losing what they typed
      if (reply) setReplyTo(reply);
      if (edit) setEditing(edit);
      Alert.alert(edit ? 'Could not edit' : 'Could not send', err.message);
    } finally {
      setSending(false);
    }
  }

  async function sendPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photos needed', 'Allow photo access to send a picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      // A full-resolution phone photo becomes ~10MB of base64, which the
      // upload limit rejects. Half quality is indistinguishable in a bubble.
      quality: 0.5,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset?.base64) {
      Alert.alert('Could not send photo', "That picture couldn't be read. Try another one.");
      return;
    }
    setSending(true);
    try {
      const data = await apiFetch('/messages', {
        method: 'POST',
        body: {
          type: 'photo',
          image: `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`,
          ...(replyTo ? { replyToMessageId: replyTo.id } : {}),
        },
      });
      setReplyTo(null);
      setMessages((prev) => mergeMessage(prev, data.message));
    } catch (err) {
      Alert.alert('Could not send photo', err.message);
    } finally {
      setSending(false);
    }
  }

  async function sendPoll(poll) {
    setPollOpen(false);
    try {
      const plain = JSON.stringify(poll);
      await post({ type: 'poll', ...(await seal(plain)), poll: { options: poll.options.length, multi: poll.multi } }, plain);
    } catch (err) {
      Alert.alert('Could not send the poll', err.message);
    }
  }

  async function sendPlace() {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Location needed', 'Allow location to share where you are.');
        return;
      }
      const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lng } = here.coords;
      // The phone's own geocoder names the place; no map service is asked.
      let label = 'My location';
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        label = [place?.name, place?.street, place?.city].filter(Boolean).slice(0, 2).join(', ') || label;
      } catch { /* the coordinates are enough */ }
      const plain = JSON.stringify({ lat, lng, label });
      await post({ type: 'location', ...(await seal(plain)) }, plain);
    } catch (err) {
      Alert.alert('Could not share the place', err.message);
    }
  }

  // ---- A message's actions ---------------------------------------------
  const react = useCallback((message, emoji) => {
    apiFetch('/presence/reactions', { method: 'PUT', body: { targetKind: 'message', targetId: message.id, emoji } })
      .then(() => setMessages((prev) => prev.map((m) => {
        if (m.id !== message.id) return m;
        const others = (m.reactions || []).filter((r) => r.userId !== meId);
        return { ...m, reactions: emoji ? [...others, { userId: meId, emoji }] : others };
      })))
      .catch((err) => Alert.alert('Could not react', err.message));
  }, [meId]);

  const vote = useCallback((message, choices) => {
    apiFetch(`/messages/${message.id}/vote`, { method: 'PUT', body: { choices } })
      .then((d) => setMessages((prev) => mergeMessage(prev, d.message)))
      .catch((err) => Alert.alert('Could not vote', err.message));
  }, []);

  const change = useCallback((path, method, body) => apiFetch(path, { method, body })
    .then((d) => {
      if (d.removed) setMessages((prev) => prev.filter((m) => `/messages/${m.id}` !== path));
      else if (d.message) setMessages((prev) => mergeMessage(prev, d.message));
      return d;
    })
    .catch((err) => Alert.alert('Could not do that', err.message)), []);

  const removeMessage = useCallback((message) => {
    Alert.alert(
      isScheduled(message) ? 'Cancel this message?' : 'Delete this message?',
      isScheduled(message) ? 'It has not been sent and will not be.' : 'It is removed for both of you.',
      [
        { text: 'Keep', style: 'cancel' },
        { text: isScheduled(message) ? 'Cancel it' : 'Delete', style: 'destructive', onPress: () => change(`/messages/${message.id}`, 'DELETE') },
      ]
    );
  }, [change]);

  const pin = useCallback((message, until) => change(`/messages/${message.id}/pin`, 'PUT', until ? { until } : {})
    .then((d) => d?.message && setPinned((list) => [d.message, ...list.filter((m) => m.id !== d.message.id)])), [change]);
  const unpin = useCallback((message) => change(`/messages/${message.id}/pin`, 'DELETE')
    .then(() => setPinned((list) => list.filter((m) => m.id !== message.id))), [change]);

  const menuRows = (m) => {
    if (!m) return [];
    const text = textOf(m);
    const deleted = isDeleted(m);
    const later = isScheduled(m);
    const isPinned = pinned.some((p) => p.id === m.id);
    return [
      !deleted && !later && { icon: 'arrow-undo-outline', label: 'Reply', onPress: () => { setEditing(null); setReplyTo(m); } },
      !deleted && m.type === 'text' && typeof text === 'string' && {
        icon: 'copy-outline', label: 'Copy', onPress: () => { if (!copyText(text)) Alert.alert('Could not copy'); },
      },
      canEdit(m, meId) && typeof text === 'string' && {
        icon: 'create-outline', label: 'Edit', hint: later ? undefined : 'For 24 hours after sending',
        onPress: () => { setReplyTo(null); setEditing(m); setDraft(text); },
      },
      later && m.sender_id === meId && { icon: 'send-outline', label: 'Send now', onPress: () => change(`/messages/${m.id}`, 'PATCH', { sendAt: 'now' }) },
      later && m.sender_id === meId && { icon: 'time-outline', label: 'Change the time', onPress: () => setLaterFor({ kind: 'reschedule', message: m }) },
      !deleted && !later && (isPinned
        ? { icon: 'pin-outline', label: 'Unpin', onPress: () => unpin(m) }
        : { icon: 'pin-outline', label: 'Pin to the top', onPress: () => pin(m) }),
      !deleted && !later && !isPinned && { icon: 'hourglass-outline', label: 'Pin for a day', onPress: () => pin(m, new Date(Date.now() + 86400000).toISOString()) },
      !deleted && !later && (m.reminder
        ? { icon: 'alarm-outline', label: 'Cancel the reminder', hint: whenLabel(m.reminder), onPress: () => change(`/messages/${m.id}/reminder`, 'DELETE').then(() => setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reminder: null } : x)))) }
        : { icon: 'alarm-outline', label: 'Remind me', onPress: () => setLaterFor({ kind: 'remind', message: m }) }),
      m.type === 'poll' && !deleted && m.sender_id === meId && !m.meta?.closed && {
        icon: 'stop-circle-outline', label: 'End the poll', onPress: () => change(`/messages/${m.id}/close`, 'POST'),
      },
      canDelete(m, meId) && { icon: 'trash-outline', label: later ? 'Cancel' : 'Delete', danger: true, onPress: () => removeMessage(m) },
    ];
  };

  const laterRows = () => {
    if (!laterFor) return [];
    const pick = async (at) => {
      const iso = at.toISOString();
      if (laterFor.kind === 'send') sendText({ sendAt: iso });
      else if (laterFor.kind === 'reschedule') change(`/messages/${laterFor.message.id}`, 'PATCH', { sendAt: iso });
      else {
        const d = await change(`/messages/${laterFor.message.id}/reminder`, 'PUT', { at: iso });
        if (d?.reminder) setMessages((prev) => prev.map((x) => (x.id === laterFor.message.id ? { ...x, reminder: d.reminder } : x)));
      }
    };
    return laterChoices().map((c) => ({ icon: 'time-outline', label: c.label, hint: whenLabel(c.at), onPress: () => pick(c.at) }));
  };

  // ---- Finding and jumping ----------------------------------------------
  const matches = useMemo(
    () => (searching ? searchMatches(messages, textOf, query) : []),
    [searching, messages, textOf, query]
  );
  const scrollToMessage = useCallback(async (id) => {
    let list = messages;
    if (!list.some((m) => m.id === id)) list = await loadAll().catch(() => list);
    const index = list.findIndex((m) => m.id === id);
    if (index < 0) return;
    atBottomRef.current = false;
    setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 }), 60);
  }, [messages, loadAll]);
  useEffect(() => {
    if (matches.length) scrollToMessage(matches[Math.min(matchAt, matches.length - 1)]);
  }, [matches, matchAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const openSearch = useCallback(async () => {
    setSearching(true);
    setQuery('');
    setMatchAt(0);
    loadAll().catch(() => {});
  }, [loadAll]);

  // From shared items (jumpTo), or a message or reminder notification
  // (messageId): go to that message.
  const jumpTo = route?.params?.jumpTo || route?.params?.messageId;
  useEffect(() => {
    if (!jumpTo || !messages.length) return;
    scrollToMessage(jumpTo);
    navigation.setParams({ jumpTo: undefined, messageId: undefined });
  }, [jumpTo, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- The thread -------------------------------------------------------
  const seenId = useMemo(() => lastSeenOwn(messages, meId), [messages, meId]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const currentMatch = matches.length ? matches[Math.min(matchAt, matches.length - 1)] : null;

  const renderItem = ({ item, index }) => {
    const mine = meId != null && item.sender_id === meId;
    const previous = index > 0 ? messages[index - 1] : null;
    const quoted = item.reply_to_message_id ? byId.get(item.reply_to_message_id) : null;
    return (
      <>
        {startsNewDay(item, previous) && (
          <View style={styles.dayRow}>
            <Text style={styles.dayLabel}>{dayLabel(item)}</Text>
          </View>
        )}
        <MessageBubble
          message={item}
          text={textOf(item)}
          mine={mine}
          meId={meId}
          partnerName={partnerName}
          replyTo={quoted}
          replyText={quoted ? textOf(quoted) : undefined}
          seen={item.id === seenId}
          highlighted={item.id === currentMatch}
          onLongPress={setMenuFor}
          onPressReply={scrollToMessage}
          onVote={vote}
          onReact={react}
        />
      </>
    );
  };

  const onScroll = useCallback(({ nativeEvent: e }) => {
    const fromBottom = e.contentSize.height - (e.contentOffset.y + e.layoutMeasurement.height);
    const bottom = fromBottom < 120;
    atBottomRef.current = bottom;
    setAtBottom((was) => (was === bottom ? was : bottom));
    if (bottom) setUnreadBelow((n) => { if (n) markSeen(); return 0; });
    if (e.contentOffset.y < 200) loadOlder();
  }, [loadOlder, markSeen]);

  if (unpaired) return <NotPaired navigation={navigation} what="Messages" />;

  const banner = pinned[0];

  return (
    <Wallpaper value={wallpaper} style={styles.container}>
      {/* The decorative stickers only make sense over the app's own
          background; on a chosen wallpaper they are clutter. */}
      {(!wallpaper || wallpaper === 'none') && <StickerField variant="minimal" />}

      {searching ? (
        <View style={styles.callBar}>
          <MorphButton onPress={() => { setSearching(false); setQuery(''); }} style={styles.backButton} accessibilityLabel="Close search">
            <Icon name="close" chip={false} size={22} color={colors.text} />
          </MorphButton>
          <TextInput
            value={query}
            onChangeText={(t) => { setQuery(t); setMatchAt(0); }}
            placeholder="Search this chat"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoFocus
            returnKeyType="search"
          />
          <Text style={[font.muted, { minWidth: 48, textAlign: 'center' }]}>
            {query ? (matches.length ? `${Math.min(matchAt, matches.length - 1) + 1}/${matches.length}` : '0') : ''}
          </Text>
          <Icon name="chevron-up" chip={false} size={22} color={colors.text}
            onPress={() => setMatchAt((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0))} />
          <Icon name="chevron-down" chip={false} size={22} color={colors.text}
            onPress={() => setMatchAt((i) => (matches.length ? (i + 1) % matches.length : 0))} />
        </View>
      ) : (
        <View style={styles.callBar}>
          <MorphButton onPress={toCamera} style={styles.backButton} accessibilityLabel="Back to the camera">
            <Icon name="chevron-back" chip={false} size={22} color={colors.text} />
          </MorphButton>
          <View style={{ flex: 1 }}>
            <Text style={font.h2} numberOfLines={1}>{partnerName || 'Messages'}</Text>
            <Text style={[styles.subtitle, partnerTyping && { color: colors.accent }]}>
              {partnerTyping ? 'typing…' : partnerName ? 'Just the two of you' : ''}
            </Text>
          </View>
          <View style={styles.barActions}>
            <MorphButton onPress={openSearch} style={styles.barButton} accessibilityLabel="Search the chat">
              <Icon name="search" chip={false} size={20} color={colors.text} />
            </MorphButton>
            <MorphButton onPress={() => navigation.navigate('SharedItems')} style={styles.barButton} accessibilityLabel="Shared photos, places, polls and links">
              <Icon name="images-outline" chip={false} size={20} color={colors.text} />
            </MorphButton>
            <MorphButton onPress={() => navigation.navigate('Wallpaper')} style={styles.barButton} accessibilityLabel="Chat wallpaper">
              <Icon3D name="picture" size={24} />
            </MorphButton>
            <CallButtons compact />
          </View>
        </View>
      )}

      {banner && !searching ? (
        <Pressable onPress={() => scrollToMessage(banner.id)} style={styles.pinned} accessibilityLabel="Go to the pinned message">
          <Icon name="pin" chip={false} size={16} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700' }}>
              Pinned{pinned.length > 1 ? ` · ${pinned.length}` : ''}{banner.pinned_until ? ` · until ${whenLabel(banner.pinned_until)}` : ''}
            </Text>
            <Text style={{ color: colors.text }} numberOfLines={1}>{previewOf(banner, textOf(banner))}</Text>
          </View>
          <Icon name="close" chip={false} size={18} color={colors.textMuted} onPress={() => unpin(banner)} />
        </Pressable>
      ) : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        style={styles.column}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => { if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: true }); }}
        onScroll={onScroll}
        scrollEventThrottle={64}
        // Older messages arriving above keep what you are reading still.
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          listRef.current?.scrollToOffset({ offset: Math.max(0, index * averageItemLength - 200), animated: false });
          setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 }), 120);
        }}
        renderItem={renderItem}
        ListHeaderComponent={loadingOlder ? <Text style={[font.muted, { textAlign: 'center' }]}>Loading earlier messages…</Text> : null}
        ListEmptyComponent={
          <View style={styles.emptyRow}>
            <Icon3D name="chat" size={56} />
            <Text style={font.muted}>Say something</Text>
          </View>
        }
      />

      {!atBottom ? (
        <Pressable
          onPress={() => { atBottomRef.current = true; listRef.current?.scrollToEnd({ animated: true }); }}
          style={[styles.toBottom, { bottom: clearance.above + 110 }]}
          accessibilityLabel={unreadBelow ? `${unreadBelow} new messages` : 'Go to the newest message'}
        >
          <Icon name="chevron-down" chip={false} size={20} color={colors.text} />
          {unreadBelow ? <Text style={styles.unread}>{unreadBelow}</Text> : null}
        </Pressable>
      ) : null}

      {/* What is encrypted, said exactly: texts, polls and places are; photos
          and voice notes are not. Tapping it opens the full list and the
          safety number. A changed key is a warning here, and blocks sending. */}
      <Pressable
        onPress={() => navigation.navigate('SafetyNumber')}
        style={[styles.column, styles.encryptionRow, keyTrust?.status === 'changed' && styles.keyWarning]}
        accessibilityRole="button"
      >
        <Icon
          name={keyTrust?.status === 'changed' ? 'alert-circle' : partnerKey ? 'lock-closed' : 'lock-open-outline'}
          chip={false}
          size={12}
          color={keyTrust?.status === 'changed' ? colors.danger : partnerKey ? colors.success : colors.textMuted}
        />
        <Text style={[styles.encryptionText, keyTrust?.status === 'changed' && { color: colors.danger }]}>
          {keyTrust?.status === 'changed'
            ? `${partnerName || 'Your partner'}'s encryption key changed. Tap to check it before sending.`
            : partnerKey
              ? `Texts, polls and places are end-to-end encrypted${keyTrust?.verified ? ' (verified)' : ''}. Photos and voice notes are not.`
              : "Not encrypted yet — waiting for your partner's key"}
        </Text>
      </Pressable>

      <View style={[styles.column, styles.composer, { marginBottom: clearance.above }]}>
        {replyTo || editing ? (
          <View style={styles.context}>
            <Icon name={editing ? 'create-outline' : 'arrow-undo-outline'} chip={false} size={18} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 12 }}>
                {editing ? 'Editing' : `Replying to ${replyTo.sender_id === meId ? 'yourself' : partnerName || 'them'}`}
              </Text>
              <Text style={{ color: colors.textMuted }} numberOfLines={1}>{previewOf(editing || replyTo, textOf(editing || replyTo))}</Text>
            </View>
            <Icon name="close" chip={false} size={18} color={colors.textMuted}
              onPress={() => { if (editing) setDraft(''); setEditing(null); setReplyTo(null); }} />
          </View>
        ) : null}
        <View style={styles.inputBar}>
          {!editing ? (
            <Icon name="add" chip chipColor={colors.surfaceAlt} onPress={() => setAttachOpen(true)} />
          ) : null}
          <TextInput
            placeholder={editing ? 'Edit message…' : 'Message…'}
            placeholderTextColor={colors.textMuted}
            value={draft}
            onChangeText={onDraft}
            style={styles.input}
            multiline
            onSubmitEditing={() => sendText()}
          />
          {/* Tap to send; hold to send later or without a notification. */}
          <Pressable
            onPress={() => sendText()}
            onLongPress={() => { if (draft.trim() && !editing) setLaterFor({ kind: 'send' }); }}
            delayLongPress={350}
            disabled={!draft.trim() || sending}
            accessibilityLabel={editing ? 'Save the edit' : 'Send'}
            accessibilityHint={editing ? undefined : 'Hold to send later or without a notification'}
          >
            <View style={[styles.sendButton, (!draft.trim() || sending) && styles.sendDisabled]}>
              <Icon name={editing ? 'checkmark' : 'send'} chip={false} color="#fff" size={18} />
            </View>
          </Pressable>
        </View>
      </View>

      <ChatSheet
        visible={Boolean(menuFor)}
        title={menuFor ? previewOf(menuFor, textOf(menuFor)) : ''}
        onClose={() => setMenuFor(null)}
        header={menuFor && !isDeleted(menuFor) && !isScheduled(menuFor) ? (
          <View style={styles.quickReactions}>
            {QUICK_REACTIONS.map((emoji) => {
              const mineNow = (menuFor.reactions || []).find((r) => r.userId === meId)?.emoji === emoji;
              const target = menuFor;
              return (
                <Pressable
                  key={emoji}
                  onPress={() => { setMenuFor(null); react(target, mineNow ? null : emoji); }}
                  style={[styles.quickReaction, mineNow && { backgroundColor: colors.accentSoft || colors.surfaceAlt }]}
                  accessibilityLabel={`React ${emoji}`}
                >
                  <Text style={{ fontSize: 26 }}>{emoji}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        rows={menuRows(menuFor)}
      />

      <ChatSheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        rows={[
          { icon: 'image-outline', label: 'Photo', onPress: sendPhoto },
          { icon: 'brush-outline', label: 'Drawing', onPress: () => navigation.navigate('Canvas') },
          { icon: 'stats-chart-outline', label: 'Poll', onPress: () => setPollOpen(true) },
          { icon: 'location-outline', label: 'Where I am', hint: 'Your location, now', onPress: sendPlace },
        ]}
      />

      <ChatSheet
        visible={Boolean(laterFor)}
        title={laterFor?.kind === 'remind' ? 'Remind me about this' : laterFor?.kind === 'reschedule' ? 'Send it at' : 'Send later'}
        onClose={() => setLaterFor(null)}
        rows={[
          ...laterRows(),
          laterFor?.kind === 'send' && {
            icon: 'notifications-off-outline', label: 'Send now, without a notification', onPress: () => sendText({ silent: true }),
          },
        ]}
      />

      <PollComposer visible={pollOpen} onCancel={() => setPollOpen(false)} onSend={sendPoll} />
    </Wallpaper>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    // On a tablet the thread is a readable column, not a 1200px-wide line.
    column: { width: '100%', maxWidth: 860, alignSelf: 'center' },
    backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: spacing.xs },
    callBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.xs,
    },
    subtitle: { color: colors.textMuted, fontSize: 12, marginTop: -2 },
    barActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    barButton: {
      width: 38, height: 38, borderRadius: 19,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    searchInput: {
      flex: 1, backgroundColor: colors.surface, color: colors.text,
      borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
      borderWidth: 1, borderColor: colors.border,
    },
    pinned: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      marginHorizontal: spacing.lg, marginTop: spacing.sm, padding: spacing.sm,
      borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      width: '100%', maxWidth: 860, alignSelf: 'center',
    },
    listContent: { padding: spacing.lg, paddingBottom: 40 },

    dayRow: { alignItems: 'center', marginVertical: spacing.md },
    dayLabel: {
      color: colors.textMuted, fontSize: 11, fontWeight: '600',
      backgroundColor: colors.surfaceAlt, overflow: 'hidden',
      borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3,
    },
    toBottom: {
      position: 'absolute', right: spacing.lg,
      width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    unread: {
      position: 'absolute', top: -6, right: -6, minWidth: 18, paddingHorizontal: 4,
      borderRadius: 9, overflow: 'hidden', textAlign: 'center',
      backgroundColor: colors.accent, color: '#fff', fontSize: 11, fontWeight: '700',
    },

    encryptionRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 4, paddingBottom: 2,
    },
    keyWarning: { borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingVertical: 4 },
    encryptionText: { fontSize: 11, color: colors.textMuted, flexShrink: 1, textAlign: 'center' },
    composer: { borderTopWidth: 1, borderTopColor: colors.border },
    context: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    },
    inputBar: {
      flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, padding: spacing.md,
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
    emptyRow: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
    quickReactions: { flexDirection: 'row', justifyContent: 'space-around', paddingBottom: spacing.sm },
    quickReaction: { padding: 6, borderRadius: 24 },
  });
