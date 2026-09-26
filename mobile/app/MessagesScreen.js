// The message thread.
//
// Two things here were plainly broken and are worth naming, because both
// looked like styling problems and neither was:
//
//  * Every message arrived twice for whoever sent it. The server emits
//    message:new with io.to(room), which includes the sender's own socket,
//    while this screen also appended the POST response. Rather than make the
//    server exclude the sender — which would lose the message on the sender's
//    other devices, and after a reconnect — the append is now idempotent:
//    messages are merged by id, so a socket echo of something already in the
//    list is a no-op.
//
//  * Photos never appeared. /media is authenticated and an <Image> cannot
//    send an Authorization header, so every one came back 401. mediaUrl()
//    now signs the URL; see services/api.js.
//
// And the thread never showed who said what — every bubble was left-aligned
// in the same colour, which is most of why it read as unfinished.
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, Image, Alert, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { apiFetch, connectSocket, mediaUrl, isUnpaired } from '../services/api';
import NotPaired from '../components/NotPaired';
import { spacing, radius } from '../theme';
import { useBarClearance } from '../components/LumaBar';
import { MorphButton } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import { useTheme } from '../components/ThemeContext';
import CallButtons from '../components/calls/CallButtons';
import { setActiveScreen } from '../services/notifications';
import Doodle from '../components/Doodle';
import Wallpaper from '../components/Wallpaper';
import { getKeyPair, encryptFor, decryptFrom, isEncrypted } from '../services/crypto';

/**
 * Adds a message without ever adding it twice.
 *
 * The same message reaches this screen by two routes — the POST response and
 * the socket broadcast — and which arrives first is a race. Keyed by id, so
 * whichever loses is discarded rather than duplicated. A re-delivery with
 * newer fields (a seen_at, say) replaces the older copy in place.
 */
export function mergeMessage(list, message) {
  if (!message?.id) return list;
  const at = list.findIndex((m) => m.id === message.id);
  if (at === -1) return [...list, message];
  const next = list.slice();
  next[at] = { ...next[at], ...message };
  return next;
}

const timeOf = (message) => {
  const raw = message.sent_at || message.sentAt;
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

/** True when enough time has passed that a date deserves restating. */
const startsNewDay = (message, previous) => {
  if (!previous) return true;
  const a = new Date(message.sent_at || message.sentAt);
  const b = new Date(previous.sent_at || previous.sentAt);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return a.toDateString() !== b.toDateString();
};

const dayLabel = (message) => {
  const date = new Date(message.sent_at || message.sentAt);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
};

export default function MessagesScreen({ navigation }) {
  const { colors, font } = useTheme();
  // The message box is the last thing on a screen the tab bar floats over.
  // It used to guess a fixed 90px margin, which clears the bar on a phone with
  // button navigation and leaves the box under it on one with a gesture strip.
  const clearance = useBarClearance();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  // Who I am, so a bubble can be placed on the right side. Without it every
  // message looked like it came from the other person.
  const [meId, setMeId] = useState(null);
  const [partnerName, setPartnerName] = useState(null);
  const [wallpaper, setWallpaper] = useState('none');
  // Their public key, which is what outgoing messages are sealed to. Until it
  // arrives there is nobody to encrypt for, and the composer says so rather
  // than quietly sending in the clear.
  const [partnerKey, setPartnerKey] = useState(null);
  // Decrypted text by message id. Kept beside the list rather than written
  // into it, so plaintext never ends up somewhere it could be persisted.
  const [plain, setPlain] = useState({});
  // Before pairing the server refuses this, correctly. That is a state, not
  // a failure, and it gets a screen rather than a dialog.
  const [unpaired, setUnpaired] = useState(false);

  const load = useCallback(() => {
    apiFetch('/messages')
      .then((d) => { setMessages(d.messages); setUnpaired(false); })
      .catch((err) => {
        if (isUnpaired(err)) { setUnpaired(true); return; }
        Alert.alert('Error', err.message);
      });
  }, []);

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
    setActiveScreen('Messages');
    return () => setActiveScreen(null);
  }, []));

  // Decryption happens here rather than in render: it is async, and a render
  // path that returns a promise shows nothing at all.
  useEffect(() => {
    let cancelled = false;
    const pending = messages.filter((m) => isEncrypted(m.content) && plain[m.id] === undefined);
    if (pending.length === 0) return undefined;

    (async () => {
      const opened = {};
      for (const message of pending) {
        // null when it cannot be opened, which is a real state worth
        // distinguishing from "not tried yet" — hence undefined above.
        opened[message.id] = await decryptFrom(partnerKey, message.content);
      }
      if (!cancelled) setPlain((prev) => ({ ...prev, ...opened }));
    })();

    return () => { cancelled = true; };
  }, [messages, partnerKey, plain]);

  useEffect(() => {
    let socketRef;
    connectSocket().then((socket) => {
      socketRef = socket;
      socket.on('message:new', ({ message }) => setMessages((prev) => mergeMessage(prev, message)));
    });
    return () => socketRef?.off('message:new');
  }, []);

  async function sendText() {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');          // cleared first: the keyboard should not wait on the network
    setSending(true);
    try {
      // Encrypted when there is a key to encrypt to, plain when there is not.
      // The fallback is deliberate and visible — the composer says which is
      // happening — because silently downgrading to plaintext while still
      // showing a padlock is the worst thing this code could do.
      const body = partnerKey
        ? { type: 'text', content: await encryptFor(partnerKey, text), encrypted: true }
        : { type: 'text', content: text };

      const data = await apiFetch('/messages', { method: 'POST', body });
      // Our own copy is decrypted locally rather than round-tripped.
      if (body.encrypted) setPlain((prev) => ({ ...prev, [data.message.id]: text }));
      setMessages((prev) => mergeMessage(prev, data.message));
    } catch (err) {
      setDraft(text);      // put it back rather than losing what they typed
      Alert.alert('Could not send', err.message);
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
        body: { type: 'photo', image: `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}` },
      });
      setMessages((prev) => mergeMessage(prev, data.message));
    } catch (err) {
      Alert.alert('Could not send photo', err.message);
    } finally {
      setSending(false);
    }
  }

  const renderItem = ({ item, index }) => {
    const mine = meId != null && item.sender_id === meId;
    const previous = index > 0 ? messages[index - 1] : null;
    const showDay = startsNewDay(item, previous);

    return (
      <>
        {showDay && (
          <View style={styles.dayRow}>
            <Text style={styles.dayLabel}>{dayLabel(item)}</Text>
          </View>
        )}
        <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
          <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
            {item.type === 'text' && (() => {
              if (!isEncrypted(item.content)) {
                return <Text style={[font.body, mine && styles.mineText]}>{item.content}</Text>;
              }
              const opened = plain[item.id];
              if (opened === undefined) {
                return <Text style={[font.muted, mine && styles.mineText]}>Decrypting…</Text>;
              }
              if (opened === null) {
                // Not a crash and not a blank bubble: say what happened.
                // Usually it means the other phone was reinstalled and has a
                // new key, which cannot open messages sealed to the old one.
                return (
                  <Text style={[font.muted, mine && styles.mineText]}>
                    Can&apos;t open this message — the keys don&apos;t match.
                  </Text>
                );
              }
              return <Text style={[font.body, mine && styles.mineText]}>{opened}</Text>;
            })()}
            {item.type === 'photo' && (
              <Image source={{ uri: mediaUrl(item.image_url) }} style={styles.photo} resizeMode="cover" />
            )}
            {item.type === 'doodle' && (
              <View style={styles.doodleFrame}>
                <Doodle strokeData={item.stroke_data} />
              </View>
            )}
            <Text style={[styles.time, mine && styles.mineTime]}>{timeOf(item)}</Text>
          </View>
        </View>
      </>
    );
  };

  if (unpaired) return <NotPaired navigation={navigation} what="Messages" />;

  return (
    <Wallpaper value={wallpaper} style={styles.container}>
      {/* The decorative stickers only make sense over the app's own
          background; on a chosen wallpaper they are clutter. */}
      {(!wallpaper || wallpaper === 'none') && <StickerField variant="minimal" />}

      {/* Calling from the conversation you are already having is the point. */}
      <View style={styles.callBar}>
        <View style={{ flex: 1 }}>
          <Text style={font.h2}>{partnerName || 'Messages'}</Text>
          {partnerName ? <Text style={styles.subtitle}>Just the two of you</Text> : null}
        </View>
        <View style={styles.barActions}>
          <MorphButton onPress={() => navigation.navigate('Wallpaper')} style={styles.barButton}>
            <Icon name="image-outline" chip={false} size={20} color={colors.accent} />
          </MorphButton>
          <CallButtons compact />
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={renderItem}
        ListEmptyComponent={
          <View style={styles.emptyRow}>
            <Icon name="chatbubble-outline" chip chipSize={40} />
            <Text style={font.muted}>Say something</Text>
          </View>
        }
      />

      <View style={styles.encryptionRow}>
        <Icon
          name={partnerKey ? 'lock-closed' : 'lock-open-outline'}
          chip={false}
          size={12}
          color={partnerKey ? colors.success : colors.textMuted}
        />
        <Text style={styles.encryptionText}>
          {partnerKey
            ? 'End-to-end encrypted'
            : "Not encrypted yet — waiting for your partner's key"}
        </Text>
      </View>

      <View style={[styles.inputBar, { marginBottom: clearance.above }]}>
        <Icon name="brush-outline" chip chipColor={colors.surfaceAlt} onPress={() => navigation.navigate('Canvas')} />
        <Icon name="image-outline" chip chipColor={colors.surfaceAlt} onPress={sendPhoto} />
        <TextInput
          placeholder="Message…"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          style={styles.input}
          multiline
          onSubmitEditing={sendText}
        />
        <Pressable onPress={sendText} disabled={!draft.trim() || sending}>
          <View style={[styles.sendButton, (!draft.trim() || sending) && styles.sendDisabled]}>
            <Icon name="send" chip={false} color="#fff" size={18} />
          </View>
        </Pressable>
      </View>
    </Wallpaper>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    callBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    },
    subtitle: { color: colors.textMuted, fontSize: 12, marginTop: -2 },
    barActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    barButton: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    listContent: { padding: spacing.lg, paddingBottom: 100 },

    dayRow: { alignItems: 'center', marginVertical: spacing.md },
    dayLabel: {
      color: colors.textMuted, fontSize: 11, fontWeight: '600',
      backgroundColor: colors.surfaceAlt, overflow: 'hidden',
      borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3,
    },

    row: { flexDirection: 'row', marginBottom: spacing.xs },
    rowMine: { justifyContent: 'flex-end' },
    rowTheirs: { justifyContent: 'flex-start' },
    bubble: {
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      maxWidth: '78%', minWidth: 64,
    },
    // Asymmetric corners: the flat one points at whoever is speaking, which
    // is the whole visual cue that says who said it.
    theirs: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderBottomLeftRadius: radius.sm,
    },
    mine: { backgroundColor: colors.accent, borderBottomRightRadius: radius.sm },
    mineText: { color: '#fff' },

    time: { fontSize: 10, color: colors.textMuted, alignSelf: 'flex-end', marginTop: 2 },
    mineTime: { color: 'rgba(255,255,255,0.75)' },

    photo: { width: 200, height: 200, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
    doodleFrame: { width: 200, height: 150 },

    encryptionRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 4, paddingBottom: 2,
    },
    encryptionText: { fontSize: 11, color: colors.textMuted },
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
    emptyRow: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  });
