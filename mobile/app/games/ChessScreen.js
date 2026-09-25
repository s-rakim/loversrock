// Chess between the two of you, one move at a time. The board is replayed
// from the move list with the same rules engine the server uses; the server
// rejects anything illegal or out of turn, and notifies the other player.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Dimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, connectSocket } from '../../services/api';
import { useCouple } from '../../components/CoupleContext';
import { Button, Card, Pill, ui } from '../../components/ui';
import CelebrationBurst from '../../components/Celebration';
import { legalMoves, replay, squareName } from '../../lib/chess';
import { useI18n } from '../../i18n';
import { colors, font, spacing, radius } from '../../theme';

const GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const BOARD = Math.min(Dimensions.get('window').width - spacing.lg * 2, 420);
const SQ = BOARD / 8;

export default function ChessScreen() {
  const { t } = useI18n();
  const { partner } = useCouple();
  const [game, setGame] = useState(null);
  const [record, setRecord] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => apiFetch('/games/chess').then((d) => { setGame(d.game); setRecord(d.record); setSelected(null); })
    .catch((err) => Alert.alert(t('common.error'), err.message)), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    let socket;
    connectSocket().then((s) => { socket = s; s.on('chess:update', load); }).catch(() => {});
    return () => socket?.off('chess:update', load);
  }, [load]);

  const state = useMemo(() => (game ? replay(game.moves) : null), [game?.moves?.length, game?.id]);
  const targets = useMemo(() => (state && selected !== null ? legalMoves(state, selected).map((m) => m.to) : []), [state, selected]);

  async function newGame(abandonCurrent = false) {
    try {
      const d = await apiFetch('/games/chess/new', { method: 'POST', body: { abandonCurrent } });
      setGame(d.game);
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }

  async function tap(idx) {
    if (!game || game.status !== 'active' || !game.myTurn || busy) return;
    const piece = state.board[idx];
    const mine = piece && (game.myColor === 'w' ? piece === piece.toUpperCase() : piece === piece.toLowerCase());
    if (selected === null || mine) { setSelected(mine ? idx : null); return; }
    if (!targets.includes(idx)) { setSelected(null); return; }
    setBusy(true);
    try {
      const d = await apiFetch(`/games/chess/${game.id}/move`, {
        method: 'POST', body: { from: squareName(selected), to: squareName(idx), promotion: 'q', index: game.moves.length },
      });
      setGame(d.game);
      setSelected(null);
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
      load();
    } finally {
      setBusy(false);
    }
  }

  function resign() {
    Alert.alert(t('chess.resignTitle'), '', [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('chess.resign'), style: 'destructive', onPress: () => apiFetch(`/games/chess/${game.id}/resign`, { method: 'POST' }).then((d) => setGame(d.game)) },
    ]);
  }

  if (!game) {
    return (
      <View style={styles.container}>
        <Card style={{ alignItems: 'center', padding: spacing.lg }}>
          <Text style={{ fontSize: 60 }}>♞</Text>
          <Text style={[font.h1, { marginVertical: spacing.sm }]}>{t('chess.title')}</Text>
          <Text style={[font.muted, { textAlign: 'center', marginBottom: spacing.md }]}>{t('chess.intro', { name: partner?.name || '' })}</Text>
          <Button title={t('chess.start')} icon="play" onPress={() => newGame()} />
        </Card>
      </View>
    );
  }

  // Draw from my side of the board.
  const flip = game.myColor === 'b';
  const order = Array.from({ length: 64 }, (_, i) => {
    const row = Math.floor(i / 8);
    const col = i % 8;
    const rank = flip ? row : 7 - row;
    const file = flip ? 7 - col : col;
    return rank * 8 + file;
  });
  const last = game.lastMove;
  const over = game.status !== 'active';
  const iWon = Boolean(game.winnerId) && game.winnerId === (game.myColor === 'w' ? game.whiteId : game.blackId);

  return (
    <View style={styles.container}>
      <View style={[ui.row, { justifyContent: 'space-between', marginBottom: spacing.sm }]}>
        <Pill text={over ? t(`chess.status.${game.status}`) : game.myTurn ? t('chess.yourMove') : t('chess.theirMove', { name: partner?.name || '' })} icon={game.inCheck && !over ? 'warning' : 'time'} color={game.myTurn ? colors.accent : colors.textMuted} />
        {record && <Text style={font.muted}>{t('chess.record', { me: record.me, them: record.partner, draws: record.draws })}</Text>}
      </View>
      <View style={styles.board}>
        {order.map((idx, i) => {
          const dark = (Math.floor(idx / 8) + (idx % 8)) % 2 === 0;
          const piece = state.board[idx];
          const name = squareName(idx);
          const isLast = last && (last.from === name || last.to === name);
          return (
            <Pressable key={idx} onPress={() => tap(idx)} style={[styles.square, { backgroundColor: dark ? '#C98E8A' : '#FCE9E6' }, isLast && { backgroundColor: dark ? '#E0A96D' : '#F6D7A7' }, selected === idx && { backgroundColor: colors.accent }]}>
              {piece ? <Text style={[styles.piece, { color: piece === piece.toUpperCase() ? '#FFFFFF' : '#2B2320', textShadowColor: piece === piece.toUpperCase() ? '#2B2320' : 'transparent' }]}>{GLYPH[piece]}</Text> : null}
              {targets.includes(idx) && <View style={[styles.hint, piece && styles.captureHint]} />}
              {i % 8 === 0 && <Text style={styles.coord}>{name[1]}</Text>}
            </Pressable>
          );
        })}
      </View>
      <Text style={[font.muted, { marginTop: spacing.sm }]}>{t('chess.playingAs', { color: t(game.myColor === 'w' ? 'chess.white' : 'chess.black') })} · {t('chess.moves', { n: game.moves.length })}</Text>
      <CelebrationBurst trigger={over && iWon ? game.id : null} size={220} />
      <View style={[ui.row, { marginTop: spacing.md }]}>
        {over ? <Button title={t('chess.rematch')} icon="refresh" onPress={() => newGame()} style={{ flex: 1 }} /> : (
          <>
            <Button kind="secondary" title={t('chess.resign')} icon="flag-outline" onPress={resign} style={{ flex: 1 }} />
            <Button kind="secondary" title={t('chess.refresh')} icon="refresh" onPress={load} style={{ flex: 1 }} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, alignItems: 'center' },
  board: { width: BOARD, height: BOARD, flexDirection: 'row', flexWrap: 'wrap', borderRadius: radius.md, overflow: 'hidden', borderWidth: 3, borderColor: colors.accentSoft },
  square: { width: SQ, height: SQ, alignItems: 'center', justifyContent: 'center' },
  piece: { fontSize: SQ * 0.72, textShadowRadius: 2, textShadowOffset: { width: 0, height: 0 } },
  hint: { position: 'absolute', width: SQ * 0.28, height: SQ * 0.28, borderRadius: SQ, backgroundColor: 'rgba(43,35,32,0.35)' },
  captureHint: { width: SQ * 0.9, height: SQ * 0.9, backgroundColor: 'transparent', borderWidth: 3, borderColor: 'rgba(43,35,32,0.35)' },
  coord: { position: 'absolute', top: 1, left: 2, fontSize: 9, color: 'rgba(43,35,32,0.5)' },
});
