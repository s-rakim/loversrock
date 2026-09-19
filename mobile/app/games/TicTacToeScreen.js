// Tic Tac Toe. Nine buttons — the point of this screen is that the nine
// buttons are all it is: the rules, the turn and the result all come from
// the server through useMatch.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { Pop } from '../../components/Motion';
import { useMatch } from '../../components/games/useMatch';
import MatchFrame from '../../components/games/MatchFrame';

const BOARD = Math.min(Dimensions.get('window').width - spacing.lg * 2, 340);
const CELL = (BOARD - 8) / 3;

export default function TicTacToeScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const m = useMatch('tic-tac-toe');

  const board = m.match?.state?.board || Array(9).fill(null);
  const winning = m.match?.state?.winningLine || [];
  const mySeat = m.match?.seat;

  return (
    <MatchFrame
      title="Tic Tac Toe"
      subtitle="Three in a row wins."
      {...m}
      onStart={m.start}
      onResign={m.resign}
    >
      <View style={[styles.board, { width: BOARD, height: BOARD }]}>
        {board.map((cell, i) => {
          const isWinning = winning.includes(i);
          const playable = m.match?.yourTurn && cell === null && m.match?.status === 'active';
          return (
            <Pressable
              key={i}
              onPress={() => playable && m.play({ cell: i })}
              disabled={!playable || m.busy}
              style={[styles.cell, { width: CELL, height: CELL }, isWinning && styles.winningCell]}
            >
              <Pop active={cell !== null}>
                {cell === null ? null : (
                  <Ionicons
                    name={cell === 1 ? 'close' : 'ellipse-outline'}
                    size={CELL * 0.55}
                    color={cell === mySeat ? colors.accentPink : colors.accentIndigo}
                  />
                )}
              </Pop>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.legend}>
        <Ionicons name={mySeat === 1 ? 'close' : 'ellipse-outline'} size={16} color={colors.accentPink} />
        <Text style={[font.muted, { marginLeft: 6 }]}>You</Text>
        <Ionicons
          name={mySeat === 1 ? 'ellipse-outline' : 'close'}
          size={16}
          color={colors.accentIndigo}
          style={{ marginLeft: spacing.md }}
        />
        <Text style={[font.muted, { marginLeft: 6 }]}>Them</Text>
      </View>
    </MatchFrame>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    board: {
      flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'center',
      backgroundColor: colors.surface, borderRadius: radius.card,
      borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    },
    cell: {
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 0.5, borderColor: colors.border,
    },
    winningCell: { backgroundColor: colors.accentSoft },
    legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  });
