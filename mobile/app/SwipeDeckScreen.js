// The swipe deck.
//
// You each go through the same stack of date ideas saying yes or no, and
// neither of you sees the other's answer until you have given your own — the
// same rule the daily prompt uses, for the same reason. Knowing they said yes
// to the pottery class changes whether you say yes to the pottery class, and
// then a match means nothing.
//
// A match is both of you saying yes, and it is worth an interruption: the
// card stops, the screen says so, and it is one tap from there to putting it
// in the calendar.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, PanResponder, Dimensions, Alert, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../services/api';
import { spacing, radius } from '../theme';
import { useTheme } from '../components/ThemeContext';
import { MorphButton } from '../components/Motion';
import Celebration from '../components/Celebration';

const { width: SCREEN } = Dimensions.get('window');

// Far enough that a scroll-ish drag is not a vote, close enough that a
// deliberate flick always is.
const THRESHOLD = SCREEN * 0.28;

const COST = { free: 'Free', low: '£', medium: '££', high: '£££' };

export default function SwipeDeckScreen({ navigation }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [deck, setDeck] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [matched, setMatched] = useState(null);
  const [voted, setVoted] = useState(0);

  const pan = useRef(new Animated.ValueXY()).current;
  // The card being animated off screen must not also be draggable, or a fast
  // second flick votes twice on the same idea.
  const busy = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/date-ideas/swipe');
      setDeck(data.deck || []);
      setVoted(data.votedSoFar || 0);
      setIndex(0);
      pan.setValue({ x: 0, y: 0 });
    } catch (err) {
      Alert.alert('Could not load the deck', err.message);
    } finally {
      setLoading(false);
    }
  }, [pan]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const vote = useCallback(async (idea, liked) => {
    try {
      const res = await apiFetch(`/date-ideas/${idea.id}/vote`, { method: 'PUT', body: { liked } });
      setVoted((n) => n + 1);
      if (res.matched) setMatched(idea);
    } catch (err) {
      // The card has already gone; putting it back would be more confusing
      // than saying the vote did not save.
      Alert.alert('That vote did not save', err.message);
    }
  }, []);

  const swipe = useCallback((liked) => {
    const idea = deck[index];
    if (!idea || busy.current) return;
    busy.current = true;

    Animated.timing(pan, {
      toValue: { x: liked ? SCREEN * 1.3 : -SCREEN * 1.3, y: 40 },
      duration: 230,
      useNativeDriver: true,
    }).start(() => {
      pan.setValue({ x: 0, y: 0 });
      setIndex((i) => i + 1);
      busy.current = false;
    });

    // Fired alongside the animation rather than after it: the card should
    // move the instant the finger leaves, not once the server has answered.
    vote(idea, liked);
  }, [deck, index, pan, vote]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      // A vertical drag is the list scrolling, not a vote.
      onMoveShouldSetPanResponder: (_e, g) => !busy.current
        && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dx) > THRESHOLD) swipeRef.current(g.dx > 0);
        else Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true, friction: 6 }).start();
      },
    })
  ).current;

  // PanResponder is built once, so it would capture the first render's
  // `swipe` — and with it the first render's empty deck — forever.
  const swipeRef = useRef(swipe);
  swipeRef.current = swipe;

  const rotate = pan.x.interpolate({
    inputRange: [-SCREEN, 0, SCREEN],
    outputRange: ['-14deg', '0deg', '14deg'],
  });
  const yesOpacity = pan.x.interpolate({ inputRange: [0, THRESHOLD], outputRange: [0, 1], extrapolate: 'clamp' });
  const noOpacity = pan.x.interpolate({ inputRange: [-THRESHOLD, 0], outputRange: [1, 0], extrapolate: 'clamp' });

  const current = deck[index];
  const next = deck[index + 1];

  const card = (idea, key) => (
    <View key={key} style={styles.cardInner}>
      <View style={styles.cardTop}>
        <Text style={styles.category}>{(idea.category || 'date').toUpperCase()}</Text>
        {idea.cost_tier ? <Text style={styles.cost}>{COST[idea.cost_tier] || idea.cost_tier}</Text> : null}
      </View>
      <Text style={[font.h1, styles.title]}>{idea.title}</Text>
      {idea.description ? <Text style={[font.body, styles.description]}>{idea.description}</Text> : null}
      <View style={{ flex: 1 }} />
      <Text style={[font.muted, { fontSize: 11 }]}>
        {idea.pair_id ? 'One of yours' : 'Suggested'}
      </Text>
    </View>
  );

  if (loading) return <View style={styles.root} />;

  if (!current) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Ionicons name="checkmark-done-outline" size={44} color={colors.textMuted} />
        <Text style={[font.h2, { marginTop: spacing.sm }]}>
          {voted > 0 ? "That's the whole deck" : 'Nothing to swipe yet'}
        </Text>
        <Text style={[font.muted, styles.emptyText]}>
          {voted > 0
            ? 'Your matches are the ones you both said yes to. New ideas show up here as they are added.'
            : 'Add a few date ideas and they will show up here for both of you to vote on.'}
        </Text>
        <MorphButton onPress={() => navigation.navigate('DateIdeas')} style={styles.primary}>
          <Text style={styles.primaryText}>See your matches</Text>
        </MorphButton>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={[font.muted, styles.counter]}>
        {deck.length - index} left · {voted} voted
      </Text>

      <View style={styles.stack}>
        {/* The one behind, slightly smaller, so the stack reads as a stack
            rather than a single card that teleports. */}
        {next && (
          <View style={[styles.card, styles.behind]} pointerEvents="none">
            {card(next, next.id)}
          </View>
        )}

        <Animated.View
          {...responder.panHandlers}
          style={[
            styles.card,
            { transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] },
          ]}
        >
          {card(current, current.id)}

          <Animated.View style={[styles.stamp, styles.stampYes, { opacity: yesOpacity }]}>
            <Text style={[styles.stampText, { color: colors.success }]}>YES</Text>
          </Animated.View>
          <Animated.View style={[styles.stamp, styles.stampNo, { opacity: noOpacity }]}>
            <Text style={[styles.stampText, { color: colors.danger }]}>NOPE</Text>
          </Animated.View>
        </Animated.View>
      </View>

      <View style={styles.buttons}>
        <MorphButton onPress={() => swipe(false)} style={[styles.round, { borderColor: colors.danger }]}>
          <Ionicons name="close" size={26} color={colors.danger} />
        </MorphButton>
        <MorphButton onPress={() => swipe(true)} style={[styles.round, { borderColor: colors.success }]}>
          <Ionicons name="heart" size={22} color={colors.success} />
        </MorphButton>
      </View>

      {/* A match stops everything, because it is the only thing in here worth
          stopping for. */}
      {matched && (
        <Pressable style={styles.matchBackdrop} onPress={() => setMatched(null)}>
          <Celebration trigger={matched.id} size={220} />
          <View style={styles.matchCard}>
            <Text style={[font.muted, styles.matchLabel]}>YOU BOTH SAID YES</Text>
            <Text style={[font.h1, { textAlign: 'center' }]}>{matched.title}</Text>
            <MorphButton
              onPress={() => { setMatched(null); navigation.navigate('DateIdeas'); }}
              style={styles.primary}
            >
              <Ionicons name="calendar-outline" size={16} color="#fff" />
              <Text style={styles.primaryText}>Put it in the calendar</Text>
            </MorphButton>
            <Pressable onPress={() => setMatched(null)}>
              <Text style={[font.muted, { marginTop: spacing.sm }]}>Keep swiping</Text>
            </Pressable>
          </View>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent', padding: spacing.md },
    centered: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    emptyText: { textAlign: 'center', marginTop: spacing.xs },
    counter: { textAlign: 'center', fontSize: 12, marginBottom: spacing.sm },
    stack: { flex: 1 },
    card: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    behind: { transform: [{ scale: 0.94 }, { translateY: 10 }], opacity: 0.7 },
    cardInner: { flex: 1, padding: spacing.lg },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    category: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: colors.accent },
    cost: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    title: { marginTop: spacing.md },
    description: { marginTop: spacing.sm },
    stamp: {
      position: 'absolute', top: spacing.lg,
      paddingVertical: 6, paddingHorizontal: spacing.md,
      borderRadius: radius.sm, borderWidth: 3,
    },
    stampYes: { left: spacing.lg, borderColor: colors.success, transform: [{ rotate: '-12deg' }] },
    stampNo: { right: spacing.lg, borderColor: colors.danger, transform: [{ rotate: '12deg' }] },
    stampText: { fontSize: 22, fontWeight: '900', letterSpacing: 2 },
    buttons: {
      flexDirection: 'row', justifyContent: 'center',
      gap: spacing.xl, paddingVertical: spacing.lg,
    },
    round: {
      width: 60, height: 60, borderRadius: 30, borderWidth: 2,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    matchBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
    },
    matchCard: {
      backgroundColor: colors.surface, borderRadius: radius.card,
      padding: spacing.xl, alignItems: 'center', gap: spacing.sm, width: '100%',
    },
    matchLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: colors.accent },
    primary: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      marginTop: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
      borderRadius: radius.pill, backgroundColor: colors.accent,
    },
    primaryText: { color: '#fff', fontWeight: '700' },
  });
