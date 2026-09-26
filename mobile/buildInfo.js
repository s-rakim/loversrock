// Which build is actually on the phone.
//
// app.json's `version` is what you intend to ship, and it stays at whatever
// you last typed there whether or not a new binary was ever installed. That
// made "it still doesn't work" impossible to tell apart from "the fix isn't
// on this phone yet", which cost more than one round of debugging.
//
// BUILD_STAMP changes with each change worth reinstalling for. Settings →
// Diagnostics shows it, so the first question always has an answer.
export const BUILD_STAMP = '2026-09-26 · render loop fixed';

/** Bumped whenever the app and the server have to agree on something new. */
export const API_CONTRACT = 3;
