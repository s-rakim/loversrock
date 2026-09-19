// What You Saying, as a race.
//
// Six shared words. Letters are revealed on demand rather than on a timer —
// a timer would mean the player who happened to have the app open first got
// a head start, and it would make the round unwinnable for whoever answered
// a message mid-game.
//
// Every reveal you take costs points, so the game is "how few letters do you
// need?" rather than "who tapped fastest".
import { IllegalMove, clone } from './shared.js';
import { REVEAL_WORDS, seededShuffle } from './wordBanks.js';

const ROUNDS = 6;
const MIN_SCORE = 5;

const maskOf = (word, revealed) =>
  word.split('').map((letter, i) => (i < revealed ? letter : '_')).join(' ');

export default {
  title: 'What You Saying',
  freeplay: true,

  create({ seed = Date.now() } = {}) {
    return {
      words: seededShuffle(REVEAL_WORDS, seed).slice(0, ROUNDS),
      index: { 1: 0, 2: 0 },
      revealed: { 1: 1, 2: 1 },
      scores: { 1: 0, 2: 0 },
      done: { 1: false, 2: false },
    };
  },

  apply(state, move, seat) {
    if (state.done[seat]) throw new IllegalMove('you have finished all your words');

    const next = clone(state);
    const index = next.index[seat];
    const word = next.words[index];

    const advance = () => {
      next.index[seat] = index + 1;
      next.revealed[seat] = 1;
      if (next.index[seat] >= ROUNDS) next.done[seat] = true;
    };

    if (move?.action === 'reveal') {
      if (next.revealed[seat] >= word.length) {
        throw new IllegalMove('the whole word is already showing');
      }
      next.revealed[seat] += 1;
      return { state: next, result: null, nextSeat: 'free' };
    }

    if (move?.action === 'skip') {
      advance();
    } else {
      const guess = String(move?.guess || '').trim().toUpperCase();
      if (!guess) throw new IllegalMove('type your guess first');
      if (guess !== word) {
        // A wrong guess reveals a letter: it costs you, and it moves the
        // round along rather than letting anyone brute-force for free.
        if (next.revealed[seat] < word.length) next.revealed[seat] += 1;
        return { state: next, result: null, nextSeat: 'free' };
      }
      // The fewer letters you needed, the better.
      next.scores[seat] += Math.max(MIN_SCORE, (word.length - next.revealed[seat]) * 10);
      advance();
    }

    if (next.done[1] && next.done[2]) {
      const [a, b] = [next.scores[1], next.scores[2]];
      return { state: next, result: a === b ? 'draw' : a > b ? 'player1' : 'player2', nextSeat: null };
    }
    return { state: next, result: null, nextSeat: 'free' };
  },

  redactFor(state, seat) {
    const opponent = seat === 1 ? 2 : 1;
    const index = state.index[seat];
    const word = state.words[index];
    return {
      mask: word ? maskOf(word, state.revealed[seat]) : null,
      length: word?.length || null,
      revealed: state.revealed[seat],
      round: index + 1,
      rounds: ROUNDS,
      score: state.scores[seat],
      done: state.done[seat],
      opponentScore: state.scores[opponent],
      opponentRound: Math.min(state.index[opponent] + 1, ROUNDS),
      opponentDone: state.done[opponent],
    };
  },
};
