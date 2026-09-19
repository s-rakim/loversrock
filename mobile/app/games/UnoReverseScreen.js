// Uno Reverse.
//
// Your hand scrolls along the bottom; theirs is a count, because a count is
// all the server will tell you. The playable cards are lifted and the rest
// are dimmed, which is worked out from the same colour/value rule the
// engine applies — a wrong guess here only means a card looks tappable and
// is then refused with the engine's own wording, never the reverse.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { MorphButton, Pop } from '../../components/Motion';
import { useMatch } from '../../components/games/useMatch';
import MatchFrame from '../../components/games/MatchFrame';

const CARD_COLOURS = {
  red: '#E23B4E', yellow: '#E8B21C', green: '#36A85E', blue: '#2F6FE0',
};
const ACTION_ICON = {
  skip: 'ban-outline', reverse: 'repeat-outline', draw2: 'add-circle-outline',
  wild: 'color-palette-outline', wild4: 'color-palette',
};

function Card({ card, dimmed, onPress, disabled, small }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const background = card.colour ? CARD_COLOURS[card.colour] : '#2A2A38';
  const width = small ? 46 : 62;
  const height = small ? 68 : 92;
  const label = ACTION_ICON[card.value] ? null : card.value;

  return (
    <Pressable onPress={onPress} disabled={disabled}>
      <View
        style={[
          styles.card,
          { backgroundColor: background, width, height },
          dimmed && styles.dimmed,
        ]}
      >
        {label !== null ? (
          <Text style={[styles.cardValue, small && { fontSize: 20 }]}>{label}</Text>
        ) : (
          <Ionicons name={ACTION_ICON[card.value]} size={small ? 20 : 28} color="#fff" />
        )}
        {card.value === 'wild4' && <Text style={styles.cardCorner}>+4</Text>}
        {card.value === 'draw2' && <Text style={styles.cardCorner}>+2</Text>}
      </View>
    </Pressable>
  );
}

export default function UnoReverseScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const m = useMatch('uno-reverse');
  const [pendingWild, setPendingWild] = useState(null);

  const s = m.match?.state;
  const hand = s?.hand || [];
  const canAct = m.match?.yourTurn && m.match?.status === 'active' && !m.busy;

  // Mirrors the engine's rule so the hand reads correctly. The server is
  // still the authority — this only decides what looks playable.
  const playable = (card) => {
    if (!s) return false;
    if (s.pendingDraw > 0) {
      return (card.value === 'draw2' && s.currentValue === 'draw2')
        || (card.value === 'wild4' && s.currentValue === 'wild4');
    }
    if (card.value === 'wild' || card.value === 'wild4') return true;
    return card.colour === s.currentColour || card.value === s.currentValue;
  };

  function tap(card) {
    if (!canAct) return;
    if (card.value === 'wild' || card.value === 'wild4') {
      setPendingWild(card);
      return;
    }
    m.play({ cardId: card.id });
  }

  function chooseColour(colour) {
    const card = pendingWild;
    setPendingWild(null);
    m.play({ cardId: card.id, colour });
  }

  return (
    <MatchFrame
      title="Uno Reverse"
      subtitle="Match the colour or the number. First to empty their hand wins."
      {...m}
      onStart={() => { setPendingWild(null); return m.start(); }}
      onResign={m.resign}
    >
      {s && (
        <>
          <View style={styles.opponentRow}>
            <Ionicons name="person-circle-outline" size={22} color={colors.textSecondary} />
            <Text style={[font.body, { marginLeft: spacing.sm, flex: 1 }]}>
              They hold {s.opponentCardCount} card{s.opponentCardCount === 1 ? '' : 's'}
            </Text>
            {s.opponentCalledUno && (
              <View style={styles.unoBadge}><Text style={styles.unoBadgeText}>UNO</Text></View>
            )}
          </View>

          <View style={styles.table}>
            <View style={styles.pile}>
              <Text style={font.muted}>Deck</Text>
              <View style={styles.deckBack}>
                <Text style={styles.deckCount}>{s.deckCount}</Text>
              </View>
            </View>

            <View style={styles.pile}>
              <Text style={font.muted}>In play</Text>
              {s.discardTop && <Card card={s.discardTop} disabled />}
            </View>

            <View style={styles.pile}>
              <Text style={font.muted}>Colour</Text>
              <View
                style={[
                  styles.colourChip,
                  { backgroundColor: s.currentColour ? CARD_COLOURS[s.currentColour] : colors.surfaceAlt },
                ]}
              />
            </View>
          </View>

          {s.pendingDraw > 0 && (
            <Text style={[font.h3, styles.penalty]}>
              {m.match.yourTurn
                ? `Draw ${s.pendingDraw} — or stack another ${s.currentValue === 'wild4' ? '+4' : '+2'}`
                : `They owe ${s.pendingDraw}`}
            </Text>
          )}

          <View style={styles.actions}>
            <MorphButton
              onPress={() => canAct && m.play({ action: 'draw' })}
              disabled={!canAct}
              style={[styles.drawButton, !canAct && styles.disabledButton]}
            >
              <Ionicons name="download-outline" size={18} color="#fff" />
              <Text style={styles.drawButtonText}>
                {s.pendingDraw > 0 ? `Draw ${s.pendingDraw}` : 'Draw a card'}
              </Text>
            </MorphButton>
          </View>

          <Text style={[font.h3, { marginTop: spacing.lg }]}>
            Your hand ({hand.length})
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hand}>
            {hand.map((card) => {
              const ok = canAct && playable(card);
              return (
                <View key={card.id} style={{ marginRight: spacing.xs }}>
                  <Pop active={ok}>
                    <Card card={card} dimmed={!ok} disabled={!canAct} onPress={() => tap(card)} />
                  </Pop>
                </View>
              );
            })}
          </ScrollView>

          {pendingWild && (
            <View style={styles.colourPicker}>
              <Text style={font.h3}>Choose a colour</Text>
              <View style={styles.colourRow}>
                {Object.entries(CARD_COLOURS).map(([name, hex]) => (
                  <Pressable key={name} onPress={() => chooseColour(name)}>
                    <View style={[styles.colourOption, { backgroundColor: hex }]} />
                  </Pressable>
                ))}
              </View>
              <MorphButton onPress={() => setPendingWild(null)} style={{ paddingVertical: spacing.sm }}>
                <Text style={font.muted}>Cancel</Text>
              </MorphButton>
            </View>
          )}
        </>
      )}
    </MatchFrame>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    card: {
      borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
      borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)',
    },
    dimmed: { opacity: 0.38 },
    cardValue: { color: '#fff', fontSize: 28, fontWeight: '800' },
    cardCorner: { position: 'absolute', top: 3, right: 5, color: '#fff', fontSize: 11, fontWeight: '700' },
    opponentRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.surface, borderRadius: radius.card,
      padding: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    unoBadge: {
      backgroundColor: colors.danger, borderRadius: radius.pill,
      paddingHorizontal: spacing.sm, paddingVertical: 2,
    },
    unoBadgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
    table: {
      flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end',
      marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.card,
      padding: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    pile: { alignItems: 'center', gap: spacing.xs },
    deckBack: {
      width: 62, height: 92, borderRadius: radius.sm, backgroundColor: '#2A2A38',
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)',
    },
    deckCount: { color: '#fff', fontWeight: '700' },
    colourChip: {
      width: 44, height: 44, borderRadius: 22,
      borderWidth: 2, borderColor: colors.border,
    },
    penalty: { textAlign: 'center', marginTop: spacing.md, color: colors.danger },
    actions: { alignItems: 'center', marginTop: spacing.md },
    drawButton: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      backgroundColor: colors.accentIndigo, borderRadius: radius.pill,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    },
    disabledButton: { opacity: 0.4 },
    drawButtonText: { color: '#fff', fontWeight: '700' },
    hand: { marginTop: spacing.sm },
    colourPicker: {
      marginTop: spacing.md, alignItems: 'center',
      backgroundColor: colors.surface, borderRadius: radius.card,
      padding: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    colourRow: { flexDirection: 'row', gap: spacing.md, marginVertical: spacing.md },
    colourOption: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: '#fff' },
  });
