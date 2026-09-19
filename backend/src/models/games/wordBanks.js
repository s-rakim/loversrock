// Shared content for the word games, and the seeded shuffle they all use.
//
// A seed rather than Math.random() is what makes these two-player: both
// phones must get the SAME words in the SAME order, or comparing scores at
// the end is comparing two different games.

export const ANAGRAM_WORDS = [
  'LOVE', 'HEART', 'KISS', 'HUGS', 'DATE', 'SWEET', 'DREAM', 'TOGETHER',
  'FOREVER', 'ADVENTURE', 'LAUGH', 'CUDDLE', 'SUNSET', 'PARTNER', 'PROMISE',
  'DEVOTED', 'TENDER', 'EMBRACE', 'WHISPER', 'CHERISH', 'MOONLIT', 'BLISS',
];

export const REVEAL_WORDS = [
  'ANNIVERSARY', 'CHOCOLATE', 'FIREWORKS', 'VACATION', 'PROPOSAL',
  'SERENADE', 'MOONLIGHT', 'BOUQUET', 'HONEYMOON', 'CANDLELIGHT',
  'BUTTERFLIES', 'SWEETHEART', 'TOGETHERNESS', 'ADORATION',
];

// Each word maps to its one correct association plus distractors. The chain
// loops, so a long run is possible without the bank running dry.
export const ASSOCIATIONS = {
  SUN: { correct: 'BEACH', distractors: ['SNOW', 'MIDNIGHT', 'CELLAR'] },
  BEACH: { correct: 'WAVES', distractors: ['DESERT', 'ATTIC', 'GLACIER'] },
  WAVES: { correct: 'OCEAN', distractors: ['MOUNTAIN', 'PAVEMENT', 'CEILING'] },
  OCEAN: { correct: 'SHIP', distractors: ['CACTUS', 'ELEVATOR', 'CANDLE'] },
  SHIP: { correct: 'ANCHOR', distractors: ['KEYBOARD', 'BALLOON', 'PILLOW'] },
  ANCHOR: { correct: 'HARBOR', distractors: ['GALAXY', 'NOTEBOOK', 'FOREST'] },
  HARBOR: { correct: 'LIGHTHOUSE', distractors: ['SUBWAY', 'BAKERY', 'ORCHARD'] },
  LIGHTHOUSE: { correct: 'STORM', distractors: ['LIBRARY', 'STADIUM', 'GARDEN'] },
  STORM: { correct: 'RAINBOW', distractors: ['DESK', 'BRIDGE', 'FENCE'] },
  RAINBOW: { correct: 'SUN', distractors: ['TUNNEL', 'CARPET', 'MIRROR'] },
};

export const LETTER_VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1,
  M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

const VOWELS = 'AEIOU';
const CONSONANTS = 'BCDFGHJKLMNPRSTVWY';

/** xorshift32 — small, fast, and identical on both phones. */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function seededShuffle(list, seed) {
  const next = rng(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Scrambles a word, never back into itself. */
export function scramble(word, seed) {
  const next = rng(seed);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const letters = word.split('');
    for (let i = letters.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    const out = letters.join('');
    if (out !== word) return out;
  }
  // A word of all identical letters cannot be scrambled; reversing is enough.
  return word.split('').reverse().join('');
}

/** A seven-letter rack with at least two vowels, so a word is always possible. */
export function makeRack(seed) {
  const next = rng(seed);
  const rack = [];
  for (let i = 0; i < 2; i += 1) rack.push(VOWELS[Math.floor(next() * VOWELS.length)]);
  for (let i = 0; i < 5; i += 1) {
    const pool = next() < 0.3 ? VOWELS : CONSONANTS;
    rack.push(pool[Math.floor(next() * pool.length)]);
  }
  return rack;
}

/** Can `word` be spelled from `rack`, letter counts respected? */
export function spellableFrom(word, rack) {
  const pool = [...rack];
  for (const letter of word) {
    const at = pool.indexOf(letter);
    if (at === -1) return false;
    pool.splice(at, 1);
  }
  return true;
}

export const scoreWord = (word) =>
  word.split('').reduce((sum, l) => sum + (LETTER_VALUES[l] || 0), 0) + (word.length >= 5 ? 5 : 0);
