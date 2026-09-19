// Perfect Pair, as a race.
//
// Both players walk the same association chain from the same starting word.
// A wrong pick ends your run; the longer run wins. Independent, so neither
// is waiting on the other — and the options are shuffled per player, so
// glancing at your partner's phone tells you nothing.
import { IllegalMove, clone } from './shared.js';
import { ASSOCIATIONS, seededShuffle, rng } from './wordBanks.js';

const WORDS = Object.keys(ASSOCIATIONS);

export default {
  title: 'Perfect Pair',
  freeplay: true,

  create({ seed = Date.now() } = {}) {
    const start = seededShuffle(WORDS, seed)[0];
    return {
      seed,
      start,
      current: { 1: start, 2: start },
      chain: { 1: [start], 2: [start] },
      scores: { 1: 0, 2: 0 },
      alive: { 1: true, 2: true },
    };
  },

  apply(state, move, seat) {
    if (!state.alive[seat]) throw new IllegalMove('your run is over');

    const next = clone(state);
    const word = next.current[seat];
    const entry = ASSOCIATIONS[word];
    const choice = String(move?.choice || '').trim().toUpperCase();

    if (!choice) throw new IllegalMove('pick a word');
    const options = [entry.correct, ...entry.distractors];
    if (!options.includes(choice)) throw new IllegalMove('that is not one of the options');

    if (choice !== entry.correct) {
      next.alive[seat] = false;
      next.lastWrong = next.lastWrong || {};
      next.lastWrong[seat] = { picked: choice, correct: entry.correct };
    } else {
      next.scores[seat] += 10 + next.chain[seat].length * 2;
      next.chain[seat].push(choice);
      next.current[seat] = choice;
      // The chain loops, so a very long run is possible; cap it so a match
      // can actually end.
      if (next.chain[seat].length >= 25) next.alive[seat] = false;
    }

    if (!next.alive[1] && !next.alive[2]) {
      const [a, b] = [next.scores[1], next.scores[2]];
      return { state: next, result: a === b ? 'draw' : a > b ? 'player1' : 'player2', nextSeat: null };
    }
    return { state: next, result: null, nextSeat: 'free' };
  },

  redactFor(state, seat) {
    const opponent = seat === 1 ? 2 : 1;
    const word = state.current[seat];
    const entry = ASSOCIATIONS[word];
    // Options shuffled per player and per position, so the correct answer
    // is not always in the same slot and a glance at the other phone is
    // useless.
    const options = entry
      ? seededShuffle([entry.correct, ...entry.distractors], state.seed + seat * 104729 + state.chain[seat].length)
      : [];
    return {
      word,
      options,
      chain: state.chain[seat],
      score: state.scores[seat],
      alive: state.alive[seat],
      lastWrong: state.lastWrong?.[seat] || null,
      opponentScore: state.scores[opponent],
      opponentChainLength: state.chain[opponent].length,
      opponentAlive: state.alive[opponent],
    };
  },
};
