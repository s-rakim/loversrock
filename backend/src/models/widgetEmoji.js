// What a home-screen widget may show as an emoji, and what it may not.
//
// One table for both platforms: the Android and iOS widgets print whatever
// emoji the summary hands them, so the choice is made once, here, and the two
// cannot drift into showing different faces for the same day.
//
// A widget sits on a home screen, which anyone who picks the phone up can
// see. So symptoms are split, deliberately:
//
//   an emoji    ordinary, shareable-at-a-glance — a headache, cramps, fatigue
//   null        NEVER on a home screen, whatever the sharing switches say —
//               anything about discharge, the cervix, flow, libido, or that
//               names the cycle outright (PMS, ovulation pain)
//
// Every symptom id the app can log must appear here as one or the other. The
// test that checks this reads the app's own catalogue, so a new symptom added
// there fails until somebody decides which side of the line it is on.

/** The ten moods the mood picker offers — the one each mascot wears. */
export const MOOD_EMOJI = {
  happy: '😊',
  loved: '🥰',
  calm: '😌',
  tired: '😴',
  stressed: '😣',
  sad: '😢',
  annoyed: '😤',
  excited: '🤩',
  lonely: '🥺',
  unwell: '🤒',
};

export const SYMPTOM_EMOJI = {
  // head
  headache: '🤕',
  migraine: '🤯',
  dizziness: '😵‍💫',
  acne: null,
  hectic_fever: '🤒',
  // body
  neck_ache: '💢',
  shoulder_ache: '💢',
  tender_breasts: null,
  breast_sensitivity: null,
  backache: '💢',
  low_back_pain: '💢',
  body_ache: '💢',
  muscle_pain: '💢',
  influenza: '🤧',
  illness: '🤒',
  cramps: '😖',
  chills: '🥶',
  hot_flashes: '🥵',
  sweating: '💦',
  swelling: null,
  weight_gain: null,
  pelvic_pain: null,
  // cervix, flow, discharge — never on a home screen
  cervical_firmness: null,
  cervical_opening: null,
  cervical_mucus: null,
  flow: null,
  spotting: null,
  irritation: null,
  fluid_dry: null,
  fluid_sticky: null,
  fluid_creamy: null,
  fluid_watery: null,
  fluid_egg_white: null,
  fluid_cottage_cheese: null,
  fluid_green: null,
  fluid_with_blood: null,
  fluid_foul_smelling: null,
  // digestion
  bloating: '🎈',
  constipation: null,
  diarrhea: null,
  nausea: '🤢',
  abdominal_cramps: '😖',
  dyspepsia: null,
  gas: null,
  hunger: '🍽️',
  cravings: '🍫',
  ovulation_pain: null,
  // mind
  anxiety: '😰',
  insomnia: '🌙',
  stress: '😣',
  moodiness: '🌦️',
  tension: '😬',
  irritability: '😤',
  unable_to_concentrate: '🌫️',
  fatigue: '😪',
  confusion: '😕',
  pms: null,
  appetite_loss: null,
  libido_change: null,
};

/** A mood's emoji, or null for anything unknown. */
export function moodEmoji(mood) {
  // hasOwn, not a bare lookup: a stored 'constructor' must not come back as
  // a function where an emoji is expected.
  return (typeof mood === 'string' && Object.hasOwn(MOOD_EMOJI, mood) && MOOD_EMOJI[mood]) || null;
}

/**
 * The emoji for a day's symptoms, safe for a home screen.
 *
 * Unknown ids and the never-on-a-home-screen ones are dropped rather than
 * shown as a placeholder. Repeats are collapsed — four aches read as one 💢 —
 * and the row is capped, because a widget has room for a glance, not a list.
 */
export function symptomEmoji(ids, max = 3) {
  const out = [];
  for (const id of ids || []) {
    const emoji = typeof id === 'string' && Object.hasOwn(SYMPTOM_EMOJI, id) ? SYMPTOM_EMOJI[id] : null;
    if (emoji && !out.includes(emoji)) out.push(emoji);
    if (out.length >= max) break;
  }
  return out;
}
