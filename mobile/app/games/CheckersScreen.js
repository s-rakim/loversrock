// Checkers.
//
// The screen does not know the rules — it asks the server which moves are
// legal by showing what the state says, and lets the server reject anything
// else. That matters most for the compulsory-capture rule: rather than
// reimplementing it here and risking a second, disagreeing copy, an illegal
// tap comes back with the engine's own explanation.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { useMatch } from '../../components/games/useMatch';
import MatchFrame from '../../components/games/MatchFrame';
import SquareBoard, { SQUARE } from '../../components/games/SquareBoard';

const empty = () => Array.from({ length: 8 }, () => Array(8).fill(null));

export default function CheckersScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const m = useMatch('checkers');
  const [selected, setSelected] = useState(null);

  const state = m.match?.state;
  const board = state?.board || empty();
  const seat = m.match?.seat;
  const mustContinue = state?.mustContinueFrom;

  function pressSquare(r, c) {
    if (!m.match?.yourTurn || m.match.status !== 'active' || m.busy) return;
    const piece = board[r][c];

    // Mid multi-jump the piece is not yours to change.
    if (mustContinue && !selected) {
      setSelected(mustContinue);
      if (piece?.seat === seat && r === mustContinue[0] && c === mustContinue[1]) return;
    }

    if (piece && piece.seat === seat) {
      setSelected(selected && selected[0] === r && selected[1] === c ? null : [r, c]);
      return;
    }
    if (selected) {
      m.play({ from: selected, to: [r, c] }).then((next) => {
        // A multi-jump keeps the same piece selected so the next hop is one tap.
        setSelected(next?.state?.mustContinueFrom || null);
      });
    }
  }

  // The destinations come from the server's own move generator, so the
  // compulsory-capture rule is reflected exactly: with a capture on the
  // board, quiet moves simply are not offered.
  const legal = m.match?.legalMoves || [];
  const highlights = useMemo(() => {
    if (!selected) return [];
    return legal
      .filter((mv) => mv.from[0] === selected[0] && mv.from[1] === selected[1])
      .map((mv) => mv.to);
  }, [selected, legal]);

  // Which of your pieces can move at all — with a capture available, that is
  // only the ones that can take.
  const movable = useMemo(
    () => new Set(legal.map((mv) => `${mv.from[0]},${mv.from[1]}`)),
    [legal]
  );

  const count = (s) => board.flat().filter((p) => p && p.seat === s).length;

  return (
    <MatchFrame
      title="Checkers"
      subtitle="Captures are compulsory, and a double jump is one turn."
      {...m}
      onStart={() => { setSelected(null); return m.start(); }}
      onResign={m.resign}
      footer={(
        <View>
          <View style={styles.tally}>
            <View style={[styles.swatch, { backgroundColor: colors.accentPink }]} />
            <Text style={[font.muted, { marginLeft: 6 }]}>You {count(seat)}</Text>
            <View style={[styles.swatch, { backgroundColor: '#2B2B3A', marginLeft: spacing.md }]} />
            <Text style={[font.muted, { marginLeft: 6 }]}>
              Them {count(seat === 1 ? 2 : 1)}
            </Text>
          </View>
          {mustContinue && (
            <Text style={[font.h3, { color: colors.accentPink, textAlign: 'center', marginTop: spacing.sm }]}>
              Keep jumping — same turn.
            </Text>
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
        renderPiece={(piece, r, c) => {
          if (!piece) return null;
          const mine = piece.seat === seat;
          return (
            <View
              style={[
                styles.piece,
                { backgroundColor: mine ? colors.accentPink : '#2B2B3A' },
                mine && movable.has(`${r},${c}`) && styles.movable,
              ]}
            >
              {piece.king && <Ionicons name="star" size={SQUARE * 0.3} color="#FFD76B" />}
            </View>
          );
        }}
      />
    </MatchFrame>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    piece: {
      width: SQUARE * 0.74, height: SQUARE * 0.74, borderRadius: SQUARE * 0.37,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)',
    },
    movable: { borderColor: '#7FC8A9', borderWidth: 3 },
    tally: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
    swatch: { width: 14, height: 14, borderRadius: 7 },
  });
