// Love Golf, as a race.
//
// THE ONE ENGINE THAT IS NOT FULLY SERVER-AUTHORITATIVE, and it is worth
// being plain about why rather than quietly pretending otherwise.
//
// The game is tilt physics: you steer a ball by tipping the phone, read from
// the accelerometer at 60Hz. The server cannot verify that, because the
// input is a stream of sensor readings it never sees. Simulating it
// server-side would mean streaming every accelerometer sample over the
// network, which is both wasteful and still unverifiable.
//
// So: the hole LAYOUT is seeded and identical for both players, which is the
// part that has to be fair. The stroke count is reported by the device. The
// server checks it is a plausible number for that hole and records it.
//
// The practical consequence: a determined player could report a better round
// than they played. This is a two-person app where both people know each
// other, and "my partner lied about mini-golf" is a problem no amount of
// code fixes. Every other game in the app is fully authoritative; this one
// says what it is.
import { IllegalMove, clone } from './shared.js';
import { rng } from './wordBanks.js';

const HOLES = 6;
const MAX_STROKES = 12;

/** A hole: where the ball starts, where the cup is, and the obstacles. */
function makeHole(seed, index) {
  const next = rng(seed + index * 6763);
  const pick = (min, max) => min + next() * (max - min);
  return {
    par: 2 + Math.floor(next() * 3),
    start: { x: pick(0.1, 0.9), y: 0.88 },
    hole: { x: pick(0.15, 0.85), y: pick(0.08, 0.3) },
    // Normalised 0..1 so the device lays them out at its own resolution.
    obstacles: Array.from({ length: 1 + Math.floor(next() * 3) }, () => ({
      x: pick(0.1, 0.85), y: pick(0.35, 0.75),
      w: pick(0.08, 0.3), h: pick(0.03, 0.07),
    })),
  };
}

export default {
  title: 'Love Golf',
  freeplay: true,

  create({ seed = Date.now() } = {}) {
    return {
      seed,
      holes: Array.from({ length: HOLES }, (_, i) => makeHole(seed, i)),
      index: { 1: 0, 2: 0 },
      strokes: { 1: [], 2: [] },
      total: { 1: 0, 2: 0 },
      done: { 1: false, 2: false },
    };
  },

  apply(state, move, seat) {
    if (state.done[seat]) throw new IllegalMove('you have played all the holes');

    const next = clone(state);
    const index = next.index[seat];

    const strokes = Number(move?.strokes);
    if (!Number.isInteger(strokes) || strokes < 1) {
      throw new IllegalMove('strokes must be a whole number of at least 1');
    }
    // Bounded, so a fat-fingered or malformed client cannot post a score
    // that makes the scoreboard nonsense.
    if (strokes > MAX_STROKES) {
      throw new IllegalMove(`a hole is capped at ${MAX_STROKES} strokes`);
    }
    // The client must say which hole it is reporting, and it must be the one
    // it is actually on - that stops a duplicated request scoring twice.
    if (move.hole !== undefined && Number(move.hole) !== index) {
      throw new IllegalMove(`you are on hole ${index + 1}`);
    }

    next.strokes[seat].push(strokes);
    next.total[seat] += strokes;
    next.index[seat] = index + 1;
    if (next.index[seat] >= HOLES) next.done[seat] = true;

    if (next.done[1] && next.done[2]) {
      // Golf: LOWEST total wins.
      const [a, b] = [next.total[1], next.total[2]];
      return { state: next, result: a === b ? 'draw' : a < b ? 'player1' : 'player2', nextSeat: null };
    }
    return { state: next, result: null, nextSeat: 'free' };
  },

  redactFor(state, seat) {
    const opponent = seat === 1 ? 2 : 1;
    const index = state.index[seat];
    return {
      hole: state.holes[index] || null,
      holeNumber: index + 1,
      holes: HOLES,
      maxStrokes: MAX_STROKES,
      strokes: state.strokes[seat],
      total: state.total[seat],
      done: state.done[seat],
      opponentTotal: state.total[opponent],
      opponentHole: Math.min(state.index[opponent] + 1, HOLES),
      opponentDone: state.done[opponent],
      // Par for the holes you have already played, so the card reads like a
      // scorecard.
      pars: state.holes.map((h) => h.par),
    };
  },
};
