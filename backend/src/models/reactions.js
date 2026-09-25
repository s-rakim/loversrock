// What can be reacted to.
//
// This list has to match the CHECK constraint on reactions.target_kind in
// schema.sql exactly. They cannot be generated from one another — one is SQL
// and one is JS — so test/feed.mjs parses the schema and compares the two,
// because the failure mode otherwise is quiet: the route accepts a kind the
// database rejects and the insert throws a 500, or the database accepts one
// the route refuses and the feature simply does not work on that item type.
export const REACTION_TARGETS = [
  // The original four: things in the message thread and the memory wall.
  'message', 'memory', 'note', 'doodle',
  // Everything the joint feed can show.
  'prompt', 'quiz', 'locket', 'drawing', 'date', 'challenge', 'checkin', 'milestone',
];

export const isReactable = (kind) => REACTION_TARGETS.includes(kind);
