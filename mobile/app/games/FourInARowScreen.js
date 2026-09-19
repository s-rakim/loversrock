// Four in a Row.
//
// This used to keep the board in useState and flip between P1 and P2 on one
// phone. It is now the same game played against your partner's phone: the
// board is the server's, and tapping a column posts a move rather than
// mutating local state.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { Pop } from '../../components/Motion';
import { useMatch } from '../../components/games/useMatch';
import MatchFrame from '../../components/games/MatchFrame';

const COLS = 7;
const ROWS = 6;
const WIDTH = Math.min(Dimensions.get('window').width - spacing.lg * 2, 360);
const CELL = WIDTH / COLS;

export default function FourInARowScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const m = useMatch('four-in-a-row');

  const board = m.match?.state?.board || Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const winning = m.match?.state?.winningLine || [];
  const lastDrop = m.match?.state?.lastDrop;
  const mySeat = m.match?.seat;
  const isWinning = (r, c) => winning.some(([wr, wc]) => wr === r && wc === c);

  const canPlay = m.match?.yourTurn && m.match?.status === 'active' && !m.busy;

  return (
    <MatchFrame
      title="Four in a Row"
      subtitle="Connect four before they do."
      {...m}
      onStart={m.start}
      onResign={m.resign}
      footer={(
        <Text style={[font.muted, { textAlign: 'center', marginTop: spacing.sm }]}>
          Tap a column to drop your piece.
        </Text>
      )}
    >
      <View style={[styles.board, { width: WIDTH }]}>
        {Array.from({ length: COLS }, (_, c) => (
          <Pressable
            key={c}
            onPress={() => canPlay && m.play({ column: c })}
            disabled={!canPlay}
            style={{ width: CELL }}
          >
            {Array.from({ length: ROWS }, (_, r) => {
              const seat = board[r][c];
              const justLanded = lastDrop && lastDrop[0] === r && lastDrop[1] === c;
              return (
                <View key={r} style={[styles.slot, { width: CELL, height: CELL }]}>
                  <Pop active={Boolean(justLanded)}>
                    <View
                      style={[
                        styles.disc,
                        { width: CELL * 0.76, height: CELL * 0.76, borderRadius: CELL * 0.38 },
                        seat === null && styles.empty,
                        seat !== null && {
                          backgroundColor: seat === mySeat ? colors.accentPink : colors.accentIndigo,
                        },
                        isWinning(r, c) && styles.winning,
                      ]}
                    />
                  </Pop>
                </View>
              );
            })}
          </Pressable>
        ))}
      </View>

      <View style={styles.legend}>
        <View style={[styles.swatch, { backgroundColor: colors.accentPink }]} />
        <Text style={[font.muted, { marginLeft: 6 }]}>You</Text>
        <View style={[styles.swatch, { backgroundColor: colors.accentIndigo, marginLeft: spacing.md }]} />
        <Text style={[font.muted, { marginLeft: 6 }]}>Them</Text>
      </View>
    </MatchFrame>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    board: {
      flexDirection: 'row', alignSelf: 'center',
      backgroundColor: colors.surface, borderRadius: radius.card,
      borderWidth: 1, borderColor: colors.border, padding: 2,
    },
    slot: { alignItems: 'center', justifyContent: 'center' },
    disc: { borderWidth: 1, borderColor: 'transparent' },
    empty: { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
    winning: { borderWidth: 3, borderColor: colors.gold },
    legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
    swatch: { width: 14, height: 14, borderRadius: 7 },
  });
