// Chess.
//
// There is no chess engine on this phone, on purpose. Legal destinations
// come from the server's own generator via match.legalMoves, so what you can
// tap and what the server will accept are the same thing by construction —
// a second implementation here would eventually disagree with the first, and
// the copy on the phone is the one that cannot be fixed without a new build.
//
// Pieces are drawn with the Unicode chess glyphs. That is not the "no emoji"
// rule being bent: U+2654-265F are text symbols present in every system
// font, not pictographic emoji, and they are the only way to get real chess
// pieces without shipping a sprite sheet.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { MorphButton } from '../../components/Motion';
import { useMatch } from '../../components/games/useMatch';
import MatchFrame from '../../components/games/MatchFrame';
import SquareBoard, { SQUARE } from '../../components/games/SquareBoard';

const GLYPHS = {
  1: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  2: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};
const PROMOTION_NAMES = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
const empty = () => Array.from({ length: 8 }, () => Array(8).fill(null));

export default function ChessScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const m = useMatch('chess');
  const [selected, setSelected] = useState(null);

  const state = m.match?.state;
  const board = state?.board || empty();
  const seat = m.match?.seat;
  const legal = m.match?.legalMoves || [];

  const movesFrom = (r, c) => legal.filter((mv) => mv.from[0] === r && mv.from[1] === c);
  const highlights = selected ? movesFrom(selected[0], selected[1]).map((mv) => mv.to) : [];

  function send(from, to, promotion) {
    setSelected(null);
    m.play({ from, to, ...(promotion ? { promotion } : {}) });
  }

  function pressSquare(r, c) {
    if (!m.match?.yourTurn || m.match.status !== 'active' || m.busy) return;
    const piece = board[r][c];

    if (piece && piece.seat === seat) {
      setSelected(selected && selected[0] === r && selected[1] === c ? null : [r, c]);
      return;
    }
    if (!selected) return;

    const candidates = movesFrom(selected[0], selected[1]).filter(
      (mv) => mv.to[0] === r && mv.to[1] === c
    );
    if (candidates.length === 0) { setSelected(null); return; }

    // A promotion arrives as four candidate moves, one per piece.
    if (candidates.length > 1 && candidates.every((mv) => mv.promotion)) {
      Alert.alert('Promote to', 'Which piece?', [
        ...['q', 'r', 'b', 'n'].map((type) => ({
          text: PROMOTION_NAMES[type],
          onPress: () => send(selected, [r, c], type),
        })),
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    send(selected, [r, c], candidates[0].promotion);
  }

  const captured = useMemo(() => {
    // What is missing from a full set, per side — a simple, honest tally.
    const full = { p: 8, r: 2, n: 2, b: 2, q: 1, k: 1 };
    const out = { 1: [], 2: [] };
    for (const side of [1, 2]) {
      const have = {};
      for (const piece of board.flat()) {
        if (piece && piece.seat === side) have[piece.type] = (have[piece.type] || 0) + 1;
      }
      for (const [type, n] of Object.entries(full)) {
        for (let i = 0; i < n - (have[type] || 0); i += 1) out[side].push(type);
      }
    }
    return out;
  }, [board]);

  const opponent = seat === 1 ? 2 : 1;

  return (
    <MatchFrame
      title="Chess"
      subtitle="Full rules — castling, en passant, promotion."
      {...m}
      onStart={() => { setSelected(null); return m.start(); }}
      onResign={m.resign}
      footer={(
        <View>
          {state?.check && m.match?.status === 'active' && (
            <Text style={[font.h2, styles.check]}>Check</Text>
          )}
          <View style={styles.capturedRow}>
            <Text style={font.muted}>You took:</Text>
            <Text style={styles.capturedGlyphs}>
              {captured[opponent].map((t) => GLYPHS[opponent][t]).join(' ') || '—'}
            </Text>
          </View>
          <View style={styles.capturedRow}>
            <Text style={font.muted}>They took:</Text>
            <Text style={styles.capturedGlyphs}>
              {captured[seat]?.map((t) => GLYPHS[seat][t]).join(' ') || '—'}
            </Text>
          </View>
          {selected && (
            <MorphButton onPress={() => setSelected(null)} style={styles.clear}>
              <Text style={font.muted}>Clear selection</Text>
            </MorphButton>
          )}
        </View>
      )}
    >
      <SquareBoard
        board={board}
        seat={seat}
        selected={selected}
        highlights={highlights}
        lastMove={state?.lastMove}
        onPressSquare={pressSquare}
        showCoordinates
        renderPiece={(piece) => {
          if (!piece) return null;
          return (
            <Text
              style={[
                styles.glyph,
                { color: piece.seat === 1 ? '#FFFFFF' : '#141414' },
              ]}
            >
              {GLYPHS[piece.seat][piece.type]}
            </Text>
          );
        }}
      />
    </MatchFrame>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    glyph: {
      fontSize: SQUARE * 0.72,
      lineHeight: SQUARE * 0.92,
      // A dark outline so the white pieces stay readable on the light squares.
      textShadowColor: 'rgba(0,0,0,0.55)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 2,
    },
    check: { color: colors.danger, textAlign: 'center', marginTop: spacing.md },
    capturedRow: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', marginTop: spacing.sm,
      backgroundColor: colors.surface, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderWidth: 1, borderColor: colors.border,
    },
    capturedGlyphs: { fontSize: 18, color: colors.textPrimary },
    clear: { alignItems: 'center', paddingVertical: spacing.sm, marginTop: spacing.sm },
  });
