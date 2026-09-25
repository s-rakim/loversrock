// The badge catalogue, and the rules that award them.
//
// In code rather than a table on purpose: this is a fixed list that ships
// with the app, and a row per badge would mean a migration every time one is
// added plus a seed that can drift out of step with the rules below. The
// pair_achievements table records only what has been EARNED.
//
// Every rule is a pure function of a stats object, so awarding is testable
// without a database and cannot accidentally depend on who is asking.
export const ACHIEVEMENTS = [
  // --- getting started
  { slug: 'paired', icon: 'link', title: 'Paired up', blurb: 'You connected your two accounts.',
    test: (s) => s.paired },
  { slug: 'first-message', icon: 'chatbubble', title: 'First word', blurb: 'Said something to each other.',
    test: (s) => s.messages >= 1 },
  { slug: 'first-photo', icon: 'camera', title: 'First locket', blurb: 'Sent a photo to their home screen.',
    test: (s) => s.widgetPhotos >= 1 },
  { slug: 'first-doodle', icon: 'brush', title: 'First doodle', blurb: 'Drew something for them.',
    test: (s) => s.doodles >= 1 },

  // --- streaks
  { slug: 'streak-7', icon: 'flame', title: 'A week alight', blurb: 'Seven days in a row.',
    test: (s) => s.longestStreak >= 7 },
  { slug: 'streak-30', icon: 'flame', title: 'A month alight', blurb: 'Thirty days in a row.',
    test: (s) => s.longestStreak >= 30 },
  { slug: 'streak-100', icon: 'flame', title: 'Still burning', blurb: 'A hundred days in a row.',
    test: (s) => s.longestStreak >= 100 },
  { slug: 'streak-365', icon: 'flame', title: 'A whole year', blurb: 'Three hundred and sixty five days.',
    test: (s) => s.longestStreak >= 365 },

  // --- talking
  { slug: 'messages-100', icon: 'chatbubbles', title: 'Chatty', blurb: 'A hundred messages between you.',
    test: (s) => s.messages >= 100 },
  { slug: 'messages-1000', icon: 'chatbubbles', title: 'Never shut up', blurb: 'A thousand messages.',
    test: (s) => s.messages >= 1000 },
  { slug: 'prompts-10', icon: 'help-circle', title: 'Getting to know you', blurb: 'Ten daily questions answered.',
    test: (s) => s.promptsAnswered >= 10 },
  { slug: 'prompts-100', icon: 'help-circle', title: 'Deep cuts', blurb: 'A hundred daily questions.',
    test: (s) => s.promptsAnswered >= 100 },

  // --- doing things
  { slug: 'quiz-perfect', icon: 'trophy', title: 'Perfect match', blurb: 'Every quiz answer the same.',
    test: (s) => s.perfectQuizzes >= 1 },
  { slug: 'games-10', icon: 'game-controller', title: 'Rivals', blurb: 'Ten games played against each other.',
    test: (s) => s.gamesFinished >= 10 },
  { slug: 'games-50', icon: 'game-controller', title: 'Nemeses', blurb: 'Fifty games.',
    test: (s) => s.gamesFinished >= 50 },
  { slug: 'bucket-first', icon: 'checkmark-done', title: 'Ticked it off', blurb: 'Completed a bucket list item.',
    test: (s) => s.bucketDone >= 1 },
  { slug: 'date-first', icon: 'calendar', title: 'It’s a date', blurb: 'Scheduled a date idea.',
    test: (s) => s.datesScheduled >= 1 },

  // --- keeping things
  { slug: 'memories-25', icon: 'images', title: 'Collectors', blurb: 'Twenty five memories saved.',
    test: (s) => s.memories >= 25 },
  { slug: 'photos-100', icon: 'heart', title: 'A hundred lockets', blurb: 'A hundred photos sent.',
    test: (s) => s.widgetPhotos >= 100 },
  { slug: 'note-sealed', icon: 'mail', title: 'Secret keeper', blurb: 'Left a sealed note.',
    test: (s) => s.sealedNotes >= 1 },
  { slug: 'year-together', icon: 'ribbon', title: 'A year of us', blurb: 'Been together a year.',
    test: (s) => s.daysTogether >= 365 },
];

export const BY_SLUG = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.slug, a]));

/** Which of the catalogue this pair's stats now satisfy. */
export function earnedFrom(stats) {
  return ACHIEVEMENTS.filter((a) => {
    try { return Boolean(a.test(stats)); } catch { return false; }
  }).map((a) => a.slug);
}

/** Catalogue plus earned state, for the screen. */
export function present(earnedSlugs) {
  const earned = new Set(earnedSlugs);
  return ACHIEVEMENTS.map(({ test, ...rest }) => ({ ...rest, earned: earned.has(rest.slug) }));
}
