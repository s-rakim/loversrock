// The one hook behind every multiplayer board.
//
// Each board screen is then only its own rules and its own drawing: it calls
// useMatch('chess'), gets { match, play, ... }, and never touches fetch or
// the socket itself.
//
// Two things here are deliberate and easy to get wrong:
//
// 1. The socket carries a NUDGE, not state. 'game:moved' says only that
//    something happened; this hook then re-fetches, so each phone receives
//    its own redacted view. Trusting a pushed payload would mean one
//    player's Uno hand arriving in a room the other is sitting in.
//
// 2. Moves are optimistic-free but ordered. Every play() sends the
//    moveCount it was looking at; a stale move comes back 409 with the
//    current board attached, which is adopted rather than retried. That is
//    what stops a double-tap on a laggy connection from playing twice.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { apiFetch, connectSocket, getSocket } from '../../services/api';

export function useMatch(game) {
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Cleared by the screen once shown; holds the engine's own wording, which
  // is far more useful than "illegal move" ("you must take the capture that
  // is available").
  const [rejection, setRejection] = useState(null);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const pull = useCallback(async () => {
    try {
      const data = await apiFetch(`/games/${game}/match`);
      if (mounted.current) { setMatch(data.match); setError(null); }
    } catch (err) {
      if (mounted.current) setError(err.message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [game]);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      const data = await apiFetch(`/games/${game}/start`, { method: 'POST' });
      if (mounted.current) { setMatch(data.match); setError(null); }
      return data.match;
    } catch (err) {
      if (mounted.current) setError(err.message);
      return null;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [game]);

  const play = useCallback(async (move) => {
    if (!match || busy) return null;
    setBusy(true);
    setRejection(null);
    try {
      const data = await apiFetch(`/games/${game}/move`, {
        method: 'POST',
        body: { move, expectedMoveCount: match.moveCount },
      });
      if (mounted.current) setMatch(data.match);
      return data.match;
    } catch (err) {
      // The server sends the live board back with a 409; take it rather than
      // leaving the screen showing a board that no longer exists.
      if (err.body?.match && mounted.current) setMatch(err.body.match);
      else await pull();
      if (mounted.current) setRejection(err.message);
      return null;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [game, match, busy, pull]);

  const resign = useCallback(async () => {
    setBusy(true);
    try {
      const data = await apiFetch(`/games/${game}/resign`, { method: 'POST' });
      if (mounted.current) setMatch(data.match);
    } catch (err) {
      if (mounted.current) setError(err.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [game]);

  // Live updates. The listener is scoped to this game so two boards open in
  // a stack do not refetch each other.
  useEffect(() => {
    let socket;
    let cancelled = false;

    (async () => {
      socket = await connectSocket();
      if (cancelled) return;
      const onMoved = (payload) => { if (payload?.game === game) pull(); };
      const onStarted = (payload) => { if (payload?.game === game) pull(); };
      socket.on('game:moved', onMoved);
      socket.on('game:started', onStarted);
      socket.emit('game:watching', { game });
      socket._loversrockGameCleanup = () => {
        socket.off('game:moved', onMoved);
        socket.off('game:started', onStarted);
      };
    })();

    return () => {
      cancelled = true;
      const live = getSocket();
      live?._loversrockGameCleanup?.();
      live?.emit('game:left', { game });
    };
  }, [game, pull]);

  // A socket can miss an event while the phone is asleep, so coming back to
  // the app always re-reads the board rather than trusting what is on screen.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') pull();
    });
    return () => sub.remove();
  }, [pull]);

  useEffect(() => { pull(); }, [pull]);

  return {
    match, loading, busy, error, rejection,
    clearRejection: () => setRejection(null),
    start, play, resign, refresh: pull,
  };
}
