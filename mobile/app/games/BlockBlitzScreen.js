// Block Blitz.
//
// The only board here with no turn: you and your partner get the same piece
// queue and your own grids, and you both go at once. Their board is shown
// small beside yours, live, because watching them build is half of it.
//
// Placement is "pick a rotation, pick a column" rather than a falling piece
// with a timer: a drop is then one discrete fact the server can check, which
// is what makes it server-authoritative without streaming gravity ticks.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { MorphButton, Pop } from '../../components/Motion';
import { useMatch } from '../../components/games/useMatch';
import MatchFrame from '../../components/games/MatchFrame';

const COLS = 10;
const ROWS = 16;
const WIDTH = Math.min(Dimensions.get('window').width - spacing.lg * 2, 300);
const CELL = WIDTH / COLS;
const MINI = CELL * 0.42;

const PIECE_COLOURS = {
  I: '#3EC7DE', O: '#E8C33C', T: '#A163D8', S: '#4FC16B',
  Z: '#E2574C', J: '#3E6FD1', L: '#E28A3C',
};
// Mirrors the engine's table so the preview and the ghost match what the
// server will actually place.
const SHAPES = {
  I: [[[0, 0], [0, 1], [0, 2], [0, 3]], [[0, 0], [1, 0], [2, 0], [3, 0]]],
  O: [[[0, 0], [0, 1], [1, 0], [1, 1]]],
  T: [[[0, 1], [1, 0], [1, 1], [1, 2]], [[0, 0], [1, 0], [1, 1], [2, 0]],
      [[0, 0], [0, 1], [0, 2], [1, 1]], [[0, 1], [1, 0], [1, 1], [2, 1]]],
  S: [[[0, 1], [0, 2], [1, 0], [1, 1]], [[0, 0], [1, 0], [1, 1], [2, 1]]],
  Z: [[[0, 0], [0, 1], [1, 1], [1, 2]], [[0, 1], [1, 0], [1, 1], [2, 0]]],
  J: [[[0, 0], [1, 0], [1, 1], [1, 2]], [[0, 0], [0, 1], [1, 0], [2, 0]],
      [[0, 0], [0, 1], [0, 2], [1, 2]], [[0, 1], [1, 1], [2, 0], [2, 1]]],
  L: [[[0, 2], [1, 0], [1, 1], [1, 2]], [[0, 0], [1, 0], [2, 0], [2, 1]],
      [[0, 0], [0, 1], [0, 2], [1, 0]], [[0, 0], [0, 1], [1, 1], [2, 1]]],
};
const cellsFor = (piece, rotation) => {
  const rotations = SHAPES[piece] || SHAPES.O;
  return rotations[((rotation % rotations.length) + rotations.length) % rotations.length];
};
const widthOf = (piece, rotation) => Math.max(...cellsFor(piece, rotation).map(([, c]) => c)) + 1;

function Grid({ board, cell, colours = PIECE_COLOURS, ghost = [], ghostColour }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isGhost = (r, c) => ghost.some(([gr, gc]) => gr === r && gc === c);

  return (
    <View style={[styles.grid, { width: cell * COLS, height: cell * ROWS }]}>
      {board.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {row.map((value, c) => (
            <View
              key={c}
              style={[
                styles.cell,
                { width: cell, height: cell },
                value ? { backgroundColor: colours[value] || colors.accentPink } : null,
                !value && isGhost(r, c) ? { backgroundColor: `${ghostColour}66` } : null,
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

export default function BlockBlitzScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const m = useMatch('block-blitz');
  const [rotation, setRotation] = useState(0);
  const [column, setColumn] = useState(3);

  const s = m.match?.state;
  const board = s?.board || Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const opponentBoard = s?.opponentBoard || board.map((row) => row.map(() => null));
  const piece = s?.current;
  const alive = s?.alive;
  const canDrop = m.match?.status === 'active' && alive && piece && !m.busy;

  // Where the piece would land, drawn faintly on the board.
  const ghost = useMemo(() => {
    if (!piece) return [];
    const cells = cellsFor(piece, rotation);
    const w = widthOf(piece, rotation);
    const col = Math.min(column, COLS - w);
    let row = -Math.max(...cells.map(([r]) => r)) - 1;
    const fits = (at) => cells.every(([r, c]) => {
      const rr = at + r; const cc = col + c;
      if (cc < 0 || cc >= COLS || rr >= ROWS) return false;
      return rr < 0 || board[rr][cc] === null;
    });
    while (fits(row + 1)) row += 1;
    return cells.map(([r, c]) => [row + r, col + c]).filter(([r]) => r >= 0);
  }, [piece, rotation, column, board]);

  const maxColumn = piece ? COLS - widthOf(piece, rotation) : COLS - 1;
  const clampedColumn = Math.min(column, maxColumn);

  function drop() {
    if (!canDrop) return;
    m.play({ column: clampedColumn, rotation });
    setRotation(0);
  }

  return (
    <MatchFrame
      title="Block Blitz"
      subtitle="Same pieces, two boards. Highest score wins."
      {...m}
      onStart={() => { setRotation(0); setColumn(3); return m.start(); }}
      onResign={m.resign}
    >
      {s && (
        <>
          <View style={styles.scoreRow}>
            <View style={styles.scoreBox}>
              <Text style={font.muted}>You</Text>
              <Text style={font.h1}>{s.score}</Text>
              <Text style={font.muted}>{s.lines} lines</Text>
            </View>
            <View style={styles.scoreBox}>
              <Text style={font.muted}>Them</Text>
              <Text style={font.h1}>{s.opponentScore}</Text>
              <Text style={font.muted}>{s.opponentLines} lines</Text>
            </View>
          </View>

          <View style={styles.boards}>
            <View>
              <Grid
                board={board}
                cell={CELL * 0.82}
                ghost={ghost}
                ghostColour={PIECE_COLOURS[piece] || colors.accentPink}
              />
              {!alive && <Text style={[font.h3, styles.toppedOut]}>Topped out</Text>}
            </View>
            <View>
              <Text style={[font.muted, { textAlign: 'center', marginBottom: 4 }]}>Theirs</Text>
              <Grid board={opponentBoard} cell={MINI} />
              {!s.opponentAlive && <Text style={[font.muted, styles.toppedOutSmall]}>Done</Text>}
            </View>
          </View>

          <View style={styles.controls}>
            <View style={styles.nextRow}>
              <Text style={font.muted}>Now</Text>
              <View style={[styles.pieceChip, { backgroundColor: PIECE_COLOURS[piece] || colors.surfaceAlt }]}>
                <Text style={styles.pieceChipText}>{piece || '—'}</Text>
              </View>
              <Text style={[font.muted, { marginLeft: spacing.md }]}>Next</Text>
              {(s.upNext || []).map((p, i) => (
                <View key={i} style={[styles.pieceChipSmall, { backgroundColor: PIECE_COLOURS[p] }]}>
                  <Text style={styles.pieceChipTextSmall}>{p}</Text>
                </View>
              ))}
              <Text style={[font.muted, { marginLeft: 'auto' }]}>{s.piecesLeft} left</Text>
            </View>

            <View style={styles.buttonRow}>
              <MorphButton
                onPress={() => setColumn((c) => Math.max(0, c - 1))}
                disabled={!canDrop}
                style={styles.stepButton}
              >
                <Ionicons name="chevron-back" size={24} color={colors.accentPink} />
              </MorphButton>

              <MorphButton
                onPress={() => setRotation((r) => r + 1)}
                disabled={!canDrop}
                style={styles.rotateButton}
              >
                <Ionicons name="refresh-outline" size={20} color={colors.accentIndigo} />
                <Text style={[font.muted, { marginLeft: 4 }]}>Rotate</Text>
              </MorphButton>

              <MorphButton
                onPress={() => setColumn((c) => Math.min(maxColumn, c + 1))}
                disabled={!canDrop}
                style={styles.stepButton}
              >
                <Ionicons name="chevron-forward" size={24} color={colors.accentPink} />
              </MorphButton>
            </View>

            <Pop active={Boolean(canDrop)}>
              <MorphButton
                onPress={drop}
                disabled={!canDrop}
                style={[styles.dropButton, !canDrop && styles.disabled]}
              >
                <Ionicons name="arrow-down" size={20} color="#fff" />
                <Text style={styles.dropButtonText}>
                  Drop in column {clampedColumn + 1}
                </Text>
              </MorphButton>
            </Pop>
          </View>
        </>
      )}
    </MatchFrame>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    grid: {
      backgroundColor: colors.surfaceAlt, borderRadius: radius.sm,
      borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    },
    cell: { borderWidth: 0.25, borderColor: 'rgba(0,0,0,0.12)' },
    scoreRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    scoreBox: {
      flex: 1, alignItems: 'center', backgroundColor: colors.surface,
      borderRadius: radius.card, padding: spacing.sm,
      borderWidth: 1, borderColor: colors.border,
    },
    boards: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    toppedOut: { color: colors.danger, textAlign: 'center', marginTop: spacing.xs },
    toppedOutSmall: { textAlign: 'center', marginTop: 2 },
    controls: { marginTop: spacing.md },
    nextRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    pieceChip: {
      width: 34, height: 34, borderRadius: radius.sm,
      alignItems: 'center', justifyContent: 'center', marginLeft: spacing.xs,
    },
    pieceChipText: { color: '#fff', fontWeight: '800' },
    pieceChipSmall: {
      width: 22, height: 22, borderRadius: 6,
      alignItems: 'center', justifyContent: 'center', marginLeft: 3,
    },
    pieceChipTextSmall: { color: '#fff', fontWeight: '700', fontSize: 11 },
    buttonRow: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', marginTop: spacing.md,
    },
    stepButton: {
      width: 56, height: 48, borderRadius: radius.md,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    rotateButton: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderRadius: radius.pill, backgroundColor: colors.surfaceAlt,
      borderWidth: 1, borderColor: colors.border,
    },
    dropButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
      backgroundColor: colors.accentPink, borderRadius: radius.pill,
      paddingVertical: spacing.md, marginTop: spacing.md,
    },
    disabled: { opacity: 0.4 },
    dropButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  });
