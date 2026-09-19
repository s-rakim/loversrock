// Love Letters, as a race.
//
// Five rounds, and both players get the SAME seven-letter rack each round,
// so it is genuinely the same puzzle. You submit one word per round; the
// higher-scoring word takes the round.
//
// Word validity is "can it be spelled from the rack", the same rule the solo
// version used. A real dictionary would be better and is not worth a
// megabyte of word list shipped to a phone for a game two people play; the
// honest consequence is that nonsense scores, and your partner can see what
// you played once the round closes.
import { IllegalMove, clone } from './shared.js';
import { makeRack, spellableFrom, scoreWord } from './wordBanks.js';

const ROUNDS = 5;
const MIN_LENGTH = 2;

export default {
  title: 'Love Letters',
  freeplay: true,

  create({ seed = Date.now() } = {}) {
    return {
      seed,
      racks: Array.from({ length: ROUNDS }, (_, i) => makeRack(seed + i * 7717)),
      index: { 1: 0, 2: 0 },
      scores: { 1: 0, 2: 0 },
      words: { 1: [], 2: [] },
      done: { 1: false, 2: false },
    };
  },

  apply(state, move, seat) {
    if (state.done[seat]) throw new IllegalMove('you have played all five rounds');

    const next = clone(state);
    const index = next.index[seat];
    const rack = next.racks[index];

    if (move?.action === 'pass') {
      next.words[seat].push({ word: null, score: 0 });
      next.index[seat] = index + 1;
    } else {
      const word = String(move?.word || '').trim().toUpperCase();
      if (word.length < MIN_LENGTH) throw new IllegalMove(`at least ${MIN_LENGTH} letters`);
      if (!/^[A-Z]+$/.test(word)) throw new IllegalMove('letters only');
      if (!spellableFrom(word, rack)) {
        throw new IllegalMove(`"${word}" cannot be spelled from ${rack.join('')}`);
      }
      const score = scoreWord(word);
      next.scores[seat] += score;
      next.words[seat].push({ word, score });
      next.index[seat] = index + 1;
    }

    if (next.index[seat] >= ROUNDS) next.done[seat] = true;

    if (next.done[1] && next.done[2]) {
      const [a, b] = [next.scores[1], next.scores[2]];
      return { state: next, result: a === b ? 'draw' : a > b ? 'player1' : 'player2', nextSeat: null };
    }
    return { state: next, result: null, nextSeat: 'free' };
  },

  redactFor(state, seat) {
    const opponent = seat === 1 ? 2 : 1;
    const index = state.index[seat];
    const bothFinished = state.done[1] && state.done[2];
    return {
      rack: state.racks[index] || null,
      round: index + 1,
      rounds: ROUNDS,
      score: state.scores[seat],
      words: state.words[seat],
      done: state.done[seat],
      opponentScore: state.scores[opponent],
      opponentRound: Math.min(state.index[opponent] + 1, ROUNDS),
      opponentDone: state.done[opponent],
      // Their words only once the match is over. Seeing them mid-match on a
      // shared rack would just be copying.
      opponentWords: bothFinished ? state.words[opponent] : null,
    };
  },
};
