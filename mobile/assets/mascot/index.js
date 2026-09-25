// Where your mascot artwork goes.
//
// React Native's bundler resolves require() at BUILD time — it cannot take a
// computed path — so art cannot be discovered from a folder at runtime. This
// file is therefore the one place to wire it up, and it is deliberately the
// only place.
//
// TO ADD YOUR MASCOT: drop the images in this folder and uncomment the
// matching lines. One image per emotion; any you leave null falls back to the
// drawn character, so you can add them one at a time and the app keeps
// working the whole way.
//
// Square images, ideally 512x512 with a transparent background. `neutral` is
// the only one that really matters — everything else falls back to it before
// it falls back to the drawing.
export const MASCOT_ART = {
  neutral: null,   // require('./neutral.png'),
  happy: null,     // require('./happy.png'),
  loved: null,     // require('./loved.png'),
  calm: null,      // require('./calm.png'),
  tired: null,     // require('./tired.png'),
  stressed: null,  // require('./stressed.png'),
  sad: null,       // require('./sad.png'),
  annoyed: null,   // require('./annoyed.png'),
  excited: null,   // require('./excited.png'),
  lonely: null,    // require('./lonely.png'),
  unwell: null,    // require('./unwell.png'),
};

/** The art for a mood, falling back to neutral, then to nothing (drawn). */
export function artFor(mood) {
  return MASCOT_ART[mood] || MASCOT_ART.neutral || null;
}

export const HAS_ART = Object.values(MASCOT_ART).some(Boolean);
