import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { spacing, radius } from '../../theme';
import { MorphButton, FadeInUp } from '../../components/Motion';
import Icon from '../../components/Icon';
import StickerField from '../../components/Stickers';
import { useTheme } from '../../components/ThemeContext';

const ROWS = 6;
const COLS = 7;

function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function checkWinner(board) {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const player = board[r][c];
      if (!player) continue;
      for (const [dr, dc] of dirs) {
        let count = 1;
        let rr = r + dr;
        let cc = c + dc;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === player) {
          count += 1;
          rr += dr;
          cc += dc;
        }
        if (count >= 4) return player;
      }
    }
  }
  return null;
}

// Local pass-and-play, full win-detection across all four directions.
export default function FourInARowScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [board, setBoard] = useState(emptyBoard);
  const [turn, setTurn] = useState('P1');
  const [winner, setWinner] = useState(null);

  function drop(col) {
    if (winner) return;
    const next = board.map((row) => [...row]);
    for (let r = ROWS - 1; r >= 0; r -= 1) {
      if (!next[r][col]) {
        next[r][col] = turn;
        setBoard(next);
        const w = checkWinner(next);
        if (w) setWinner(w);
        else setTurn(turn === 'P1' ? 'P2' : 'P1');
        return;
      }
    }
  }

  function reset() {
    setBoard(emptyBoard());
    setTurn('P1');
    setWinner(null);
  }

  return (
    <View style={styles.container}>
      {winner && <StickerField variant="celebrate" />}
      <FadeInUp>
        <View style={styles.statusRow}>
          {winner && <Icon name="sparkles" color={colors.gold} size={18} />}
          <Text style={font.h2}>{winner ? `${winner} wins!` : `${turn}'s turn`}</Text>
        </View>
      </FadeInUp>

      <View style={styles.board}>
        {board.map((row, r) => (
          <View key={r} style={styles.row}>
            {row.map((cell, c) => (
              <Pressable key={c} onPress={() => drop(c)} style={styles.cell}>
                {cell && <View style={[styles.piece, cell === 'P1' ? styles.p1 : styles.p2]} />}
              </Pressable>
            ))}
          </View>
        ))}
      </View>

      <MorphButton onPress={reset} style={styles.resetButton}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>New game</Text>
      </MorphButton>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', padding: spacing.lg },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  board: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.xs, marginVertical: spacing.lg },
  row: { flexDirection: 'row' },
  cell: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  piece: { width: 32, height: 32, borderRadius: 16 },
  p1: { backgroundColor: colors.accent },
  p2: { backgroundColor: '#6affe0' },
  resetButton: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
});
