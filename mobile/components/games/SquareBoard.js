// The 8x8 board shared by Checkers and Chess.
//
// Both are tap-a-square-then-tap-a-destination, both need the board flipped
// so your own pieces are always nearest you, and both need the same
// selected / legal-destination highlighting. Only the piece rendering
// differs, which is what `renderPiece` is for.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions } from 'react-native';
import { spacing, radius } from '../../theme';
import { useTheme } from '../ThemeContext';

const SIZE = 8;
const BOARD = Math.min(Dimensions.get('window').width - spacing.lg * 2, 360);
const SQUARE = BOARD / SIZE;

export { SQUARE, BOARD };

export default function SquareBoard({
  board,
  seat,
  selected,
  highlights = [],
  lastMove = null,
  onPressSquare,
  renderPiece,
  showCoordinates = false,
}) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Seat 2 sits at the top of the engine's board, so their screen is flipped
  // — everyone plays up the board, which is what a physical board does.
  const flipped = seat === 2;
  const viewRow = (r) => (flipped ? SIZE - 1 - r : r);
  const viewCol = (c) => (flipped ? SIZE - 1 - c : c);

  const isHighlighted = (r, c) => highlights.some(([hr, hc]) => hr === r && hc === c);
  const isSelected = (r, c) => selected && selected[0] === r && selected[1] === c;
  const isLastMove = (r, c) => lastMove
    && ((lastMove.from[0] === r && lastMove.from[1] === c)
      || (lastMove.to[0] === r && lastMove.to[1] === c));

  return (
    <View style={[styles.board, { width: BOARD, height: BOARD }]}>
      {Array.from({ length: SIZE }, (_, vr) => (
        <View key={vr} style={{ flexDirection: 'row' }}>
          {Array.from({ length: SIZE }, (_, vc) => {
            const r = viewRow(vr);
            const c = viewCol(vc);
            const dark = (r + c) % 2 === 1;
            return (
              <Pressable
                key={vc}
                onPress={() => onPressSquare(r, c)}
                style={[
                  styles.square,
                  { width: SQUARE, height: SQUARE },
                  dark ? styles.dark : styles.light,
                  isLastMove(r, c) && styles.lastMove,
                  isSelected(r, c) && styles.selected,
                ]}
              >
                {isHighlighted(r, c) && <View style={styles.dot} />}
                {renderPiece(board[r][c], r, c)}
                {showCoordinates && vc === 0 && (
                  <Text style={[font.muted, styles.rank]}>{SIZE - r}</Text>
                )}
                {showCoordinates && vr === SIZE - 1 && (
                  <Text style={[font.muted, styles.file]}>{'abcdefgh'[c]}</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    board: {
      alignSelf: 'center', borderRadius: radius.md, overflow: 'hidden',
      borderWidth: 1, borderColor: colors.border,
    },
    square: { alignItems: 'center', justifyContent: 'center' },
    light: { backgroundColor: '#EFE3DA' },
    dark: { backgroundColor: '#B98B6B' },
    lastMove: { backgroundColor: '#D8C76B' },
    selected: { backgroundColor: '#7FC8A9' },
    dot: {
      position: 'absolute', width: SQUARE * 0.3, height: SQUARE * 0.3,
      borderRadius: SQUARE * 0.15, backgroundColor: 'rgba(0,0,0,0.28)',
    },
    rank: { position: 'absolute', top: 1, left: 2, fontSize: 9, color: '#3A2A1E' },
    file: { position: 'absolute', bottom: 1, right: 2, fontSize: 9, color: '#3A2A1E' },
  });
