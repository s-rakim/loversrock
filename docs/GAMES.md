# Games

Every game in the app is played against your partner. There are no solo
games — the five that used to be single-player are now races.

| Game | Shape | Authority |
|---|---|---|
| Tic Tac Toe | Turn-based | Server |
| Four in a Row | Turn-based | Server |
| Checkers | Turn-based | Server |
| Chess | Turn-based | Server |
| Uno Reverse | Turn-based, hidden hands | Server |
| Block Blitz | Race, shared piece queue | Server |
| Anagrams | Race, shared words | Server |
| What You Saying | Race, shared words | Server |
| Perfect Pair | Race, shared chain | Server |
| Love Letters | Race, shared rack | Server |
| Love Golf | Race, shared course | **Client-reported score** — see below |
| Draw Duel | Live, one draws one guesses | Socket relay, no board state |

## The match layer

`game_matches` holds the board, whose turn it is and the result, scoped by
`pair_id`. A move is a `POST` the server validates against the current state;
an illegal move is a `400` and changes nothing.

Three gates, none of which reads anything the client said about itself:

1. You are in this match.
2. It is your turn (skipped for `freeplay` games — see below).
3. The engine says the move is legal.

A partial unique index on `(pair_id, game) WHERE status = 'active'` means two
phones tapping *play* at the same instant land in **one** match, not two; the
losing insert's `23505` is caught and turned into a join.

**Sockets carry a nudge, never state.** `game:moved` says only that something
happened; each phone then re-fetches its own redacted view. Accepting a move
over the socket would mean trusting the client for whose turn it is, and
pushing full state would mean emitting one player's Uno hand into a room the
other is sitting in.

## Turn-based vs. freeplay

Most games alternate. Six do not: Block Blitz, Anagrams, What You Saying,
Perfect Pair, Love Letters and Love Golf are **races**. Both players get the
same seeded content and their own progress, and neither ever waits.

An engine declares this with `freeplay: true`, and the match layer skips its
turn check for it. Forcing these into turns would ruin them — you would be
sitting watching a "their turn" pill while your partner unscrambled a word.

The seed is what makes a race fair: same seed, same words, same racks, same
holes, same piece queue. `backend/test/gameEngines.mjs` asserts that two
matches built from one seed are byte-identical, and that two seeds differ.

## Hidden information

`redactFor(state, seat)` is on the engine contract and is applied on the way
out of **every** endpoint. There is no path that skips it.

- **Uno** — you get your hand, their card *count*, and a deck *count*. Their
  cards and the deck order never leave the server.
- **Anagrams / What You Saying** — you get your current scramble or mask.
  The word list is not in the payload, so the answers to rounds you have not
  reached yet cannot be read out of it.
- **Perfect Pair** — the options are shuffled *per player and per position*,
  so glancing at your partner's phone tells you nothing, and the correct
  answer is never labelled.
- **Love Letters** — their words appear only once you have **both** finished.
  On a shared rack, seeing them earlier would just be copying.

## Chess is verified by perft

The move generator is checked against the published node counts from the
initial position — count every legal position N plies deep and compare:

```
perft(1) = 20        perft(3) = 8902
perft(2) = 400       perft(4) = 197281   (PERFT4=1, ~13s)
```

A generator subtly wrong about pins, castling, en passant or promotion
cannot hit those numbers by accident. Castling, en passant, promotion, the
fifty-move rule and threefold repetition are all implemented; "legal" means
legal, not pseudo-legal — every candidate is played on a scratch board and
discarded if it leaves the mover's own king attacked.

## Love Golf is the one exception, and here is why

Love Golf's input is a 60Hz accelerometer stream. The server never sees it,
and simulating the physics server-side would mean streaming every sensor
sample over the network — wasteful, and *still* unverifiable.

So the split is:

- **The hole layout is seeded and served.** Both players get the identical
  course. That is the part that has to be fair, and it is.
- **The stroke count is reported by the device.** The server checks it is a
  whole number between 1 and 12, and that you are reporting the hole you are
  actually on (which stops a retried request scoring twice).

The consequence, stated plainly: a determined player could report a better
round than they played. This is a two-person app where both people know each
other, and *"my partner lied about mini-golf"* is not a problem code solves.
Every other game in the app is fully authoritative; this one says what it is.

## Draw Duel

The only game with no match row. It is a live socket game — one person
draws, the other guesses — and there is no board state to be authoritative
about, so it uses the same relay as Thumb Kiss. Strokes now carry the full
doodle format (colour, width, tool), so a neon squiggle arrives as a neon
squiggle.

## Tests

- `backend/test/gameEngines.mjs` — the rules themselves, no server, no
  database. 178 assertions including perft.
- `backend/test/games.mjs` — the match layer against a live stack with two
  real accounts and a third outside the pair. 120 assertions.
