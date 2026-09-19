// Uno Reverse.
//
// The first game in the app with hidden information, which is the whole
// reason redactFor() exists on the engine contract. The state holds both
// hands and the undealt deck; if any endpoint returned it raw, one phone
// could read the other's cards. redactFor() is applied on the way out of
// every route and every socket push, and there is no path that skips it —
// backend/test/games.mjs asserts exactly that.
//
// Two-player rules, as the official ones specify: a Reverse acts as a Skip,
// because with two players reversing the direction returns the turn to you.
import { IllegalMove, clone, other } from './shared.js';

const COLOURS = ['red', 'yellow', 'green', 'blue'];
const HAND_SIZE = 7;

/** A standard 108-card deck. */
function buildDeck() {
  const deck = [];
  let id = 0;
  const add = (card) => deck.push({ ...card, id: `c${id++}` });

  for (const colour of COLOURS) {
    add({ colour, value: '0' });
    for (let n = 1; n <= 9; n += 1) {
      add({ colour, value: String(n) });
      add({ colour, value: String(n) });
    }
    for (const action of ['skip', 'reverse', 'draw2']) {
      add({ colour, value: action });
      add({ colour, value: action });
    }
  }
  for (let i = 0; i < 4; i += 1) {
    add({ colour: null, value: 'wild' });
    add({ colour: null, value: 'wild4' });
  }
  return deck;
}

/**
 * Fisher-Yates, seeded so a shuffle is reproducible from the match record.
 * Math.random() would make a match impossible to replay from game_moves.
 */
function shuffle(deck, seed) {
  const out = [...deck];
  let s = seed >>> 0;
  const next = () => {
    // xorshift32 — small, fast, and deterministic across platforms.
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Puts the discard pile back under the deck when the deck runs dry. */
function replenish(state) {
  if (state.deck.length > 0) return;
  const top = state.discard[state.discard.length - 1];
  const recycled = state.discard.slice(0, -1).map((card) => (
    // A wild goes back in colourless, or the deck slowly fills with
    // pre-coloured wilds and the game drifts.
    card.value === 'wild' || card.value === 'wild4' ? { ...card, colour: null } : card
  ));
  state.deck = shuffle(recycled, state.reshuffleSeed);
  state.reshuffleSeed = (state.reshuffleSeed * 1664525 + 1013904223) >>> 0;
  state.discard = [top];
}

function drawCards(state, seat, count) {
  for (let i = 0; i < count; i += 1) {
    replenish(state);
    if (state.deck.length === 0) return; // both piles exhausted; nothing to draw
    state.hands[seat].push(state.deck.pop());
  }
}

function playable(card, currentColour, currentValue) {
  if (card.value === 'wild' || card.value === 'wild4') return true;
  return card.colour === currentColour || card.value === currentValue;
}

export default {
  title: 'Uno Reverse',

  create({ seed = Date.now() } = {}) {
    const state = {
      deck: shuffle(buildDeck(), seed),
      discard: [],
      hands: { 1: [], 2: [] },
      currentColour: null,
      currentValue: null,
      pendingDraw: 0,
      lastAction: null,
      reshuffleSeed: (seed * 22695477 + 1) >>> 0,
      calledUno: { 1: false, 2: false },
    };

    for (let i = 0; i < HAND_SIZE; i += 1) {
      state.hands[1].push(state.deck.pop());
      state.hands[2].push(state.deck.pop());
    }

    // The starting card cannot be a wild draw four — official rule, and it
    // would otherwise punish player one for nothing.
    let starter = state.deck.pop();
    while (starter.value === 'wild4') {
      state.deck.unshift(starter);
      starter = state.deck.pop();
    }
    state.discard.push(starter);
    state.currentValue = starter.value;
    // A leading wild leaves the colour open; player one names it by playing.
    state.currentColour = starter.colour;
    return state;
  },

  apply(state, move, seat) {
    const next = clone(state);
    const hand = next.hands[seat];
    const opponent = other(seat);

    if (move?.action === 'draw') {
      // Drawing settles any pending penalty; otherwise it is one card.
      const count = next.pendingDraw > 0 ? next.pendingDraw : 1;
      drawCards(next, seat, count);
      next.lastAction = { seat, action: 'draw', count };
      next.pendingDraw = 0;
      next.calledUno[seat] = false;
      return { state: next, result: null, nextSeat: opponent };
    }

    const index = hand.findIndex((c) => c.id === move?.cardId);
    if (index === -1) throw new IllegalMove('you do not hold that card');
    const card = hand[index];

    // A pending draw can only be answered by drawing, or by stacking another
    // draw card of the same kind.
    if (next.pendingDraw > 0) {
      const stackable = (card.value === 'draw2' && next.currentValue === 'draw2')
        || (card.value === 'wild4' && next.currentValue === 'wild4');
      if (!stackable) {
        throw new IllegalMove(`you must draw ${next.pendingDraw} or stack another ${next.currentValue}`);
      }
    } else if (!playable(card, next.currentColour, next.currentValue)) {
      throw new IllegalMove('that card does not match the colour or the number');
    }

    let colour = card.colour;
    if (card.value === 'wild' || card.value === 'wild4') {
      colour = move?.colour;
      if (!COLOURS.includes(colour)) {
        throw new IllegalMove(`choose a colour: ${COLOURS.join(', ')}`);
      }
    }

    hand.splice(index, 1);
    next.discard.push({ ...card, colour });
    next.currentColour = colour;
    next.currentValue = card.value;
    next.lastAction = { seat, action: 'play', card: { ...card, colour } };
    next.calledUno[seat] = hand.length === 1;

    if (hand.length === 0) {
      return { state: next, result: seat === 1 ? 'player1' : 'player2', nextSeat: null };
    }

    if (card.value === 'draw2') next.pendingDraw += 2;
    if (card.value === 'wild4') next.pendingDraw += 4;

    // With two players, skip and reverse both return the turn to the player
    // who played them.
    const playAgain = card.value === 'skip' || card.value === 'reverse';
    return { state: next, result: null, nextSeat: playAgain ? seat : opponent };
  },

  /**
   * What this player may see: their own hand in full, the opponent's as a
   * count, and the deck as a count. The opponent's cards and the deck order
   * never leave the server.
   */
  redactFor(state, seat) {
    const opponent = other(seat);
    return {
      hand: state.hands[seat],
      opponentCardCount: state.hands[opponent].length,
      deckCount: state.deck.length,
      discardTop: state.discard[state.discard.length - 1] || null,
      discardCount: state.discard.length,
      currentColour: state.currentColour,
      currentValue: state.currentValue,
      pendingDraw: state.pendingDraw,
      lastAction: state.lastAction,
      opponentCalledUno: state.calledUno[opponent],
    };
  },
};
