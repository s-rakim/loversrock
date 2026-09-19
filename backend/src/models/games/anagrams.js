// Anagrams, as a race.
//
// Both players get the same eight scrambled words in the same order and
// work through them independently — nobody waits for a turn. The seed is
// what makes that fair: same seed, same scramble, same sequence.
//
// redactFor hides the answers, obviously, but it also hides which words the
// other player has solved until the match is over. Watching them pull ahead
// is the fun; seeing their answers is cheating.
import { IllegalMove, clone } from './shared.js';
import { ANAGRAM_WORDS, seededShuffle, scramble } from './wordBanks.js';

const ROUNDS = 8;

export default {
  title: 'Anagrams',
  freeplay: true,

  create({ seed = Date.now() } = {}) {
    const chosen = seededShuffle(ANAGRAM_WORDS, seed).slice(0, ROUNDS);
    return {
      words: chosen,
      scrambles: chosen.map((word, i) => scramble(word, seed + i * 7919)),
      index: { 1: 0, 2: 0 },
      scores: { 1: 0, 2: 0 },
      solved: { 1: [], 2: [] },
      misses: { 1: 0, 2: 0 },
      done: { 1: false, 2: false },
    };
  },

  apply(state, move, seat) {
    if (state.done[seat]) throw new IllegalMove('you have finished all your words');

    const next = clone(state);
    const index = next.index[seat];
    const answer = next.words[index];

    if (move?.action === 'skip') {
      next.solved[seat].push(false);
      next.index[seat] = index + 1;
    } else {
      const guess = String(move?.guess || '').trim().toUpperCase();
      if (!guess) throw new IllegalMove('type your answer first');
      if (guess !== answer) {
        // A wrong guess costs a little but never blocks progress, so one
        // hard word cannot strand a player while their partner races on.
        next.misses[seat] += 1;
        next.scores[seat] = Math.max(0, next.scores[seat] - 2);
        return { state: next, result: null, nextSeat: 'free' };
      }
      // Longer words are worth more; a clean solve is worth more than a
      // scrappy one.
      next.scores[seat] += answer.length * 10;
      next.solved[seat].push(true);
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
    return {
      // Your current puzzle only — never the word list, which would be the
      // answers to every round you have not reached yet.
      scrambled: state.scrambles[index] || null,
      length: state.words[index]?.length || null,
      round: index + 1,
      rounds: ROUNDS,
      score: state.scores[seat],
      misses: state.misses[seat],
      solved: state.solved[seat],
      done: state.done[seat],
      opponentScore: state.scores[opponent],
      opponentRound: Math.min(state.index[opponent] + 1, ROUNDS),
      opponentDone: state.done[opponent],
    };
  },
};
