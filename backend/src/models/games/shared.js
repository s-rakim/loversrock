// Helpers every engine uses.
//
// These live here rather than in index.js on purpose: index.js imports the
// engines, so an engine importing back from index.js is a cycle, and ESM
// resolves it by handing the engine an uninitialised binding
// ("Cannot access 'checkers' before initialization"). A leaf module with no
// imports of its own cannot cycle.

/** Thrown by an engine when a move is not legal. Routes turn it into a 400. */
export class IllegalMove extends Error {
  constructor(message) {
    super(message);
    this.name = 'IllegalMove';
  }
}

export const other = (seat) => (seat === 1 ? 2 : 1);

/** Deep-clones a plain-JSON state. Engines must not mutate their input. */
export const clone = (value) => JSON.parse(JSON.stringify(value));
