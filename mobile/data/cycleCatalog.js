// The symptom, mood and flow catalogue behind the cycle tracker.
//
// Laid out to match the reference period app screen for screen: a four-column
// grid of round pale chips, grouped under Head / Body / Cervix / Fluid /
// Abdomen / Mental, with a separate Add Mood grid.
//
// The reference app draws each chip with illustrated artwork. This app draws
// them with Ionicons vector glyphs instead, for the reason already pinned in
// components/Icon.js: emoji and bitmap stickers render inconsistently across
// devices and cannot take a chip background or a pressed state. The layout,
// grouping, wording and tap behaviour are the reference app's; only the
// artwork medium differs.
//
// `id` is what goes in the database (period_daily_logs.symptoms / .moods) and
// must never change once shipped — `label` is free to be reworded.

export const SYMPTOM_GROUPS = [
  {
    id: 'head',
    label: 'Head',
    items: [
      { id: 'headache', label: 'Headache', icon: 'thunderstorm-outline' },
      { id: 'migraine', label: 'Migraines', icon: 'flash-outline' },
      { id: 'dizziness', label: 'Dizziness', icon: 'sync-outline' },
      { id: 'acne', label: 'Acne', icon: 'ellipse-outline' },
      { id: 'hectic_fever', label: 'Hectic fever', icon: 'thermometer-outline' },
    ],
  },
  {
    id: 'body',
    label: 'Body',
    items: [
      { id: 'neck_ache', label: 'Neck aches', icon: 'body-outline' },
      { id: 'shoulder_ache', label: 'Shoulder aches', icon: 'accessibility-outline' },
      { id: 'tender_breasts', label: 'Tender breasts', icon: 'heart-dislike-outline' },
      { id: 'breast_sensitivity', label: 'Breast sensitivity', icon: 'heart-half-outline' },
      { id: 'backache', label: 'Backaches', icon: 'walk-outline' },
      { id: 'low_back_pain', label: 'Low back pain', icon: 'trending-down-outline' },
      { id: 'body_ache', label: 'Body aches', icon: 'bandage-outline' },
      { id: 'muscle_pain', label: 'Muscle pain', icon: 'barbell-outline' },
      { id: 'influenza', label: 'Influenza', icon: 'medkit-outline' },
      { id: 'illness', label: 'Illness', icon: 'pulse-outline' },
      { id: 'cramps', label: 'Cramps', icon: 'flash-off-outline' },
      { id: 'chills', label: 'Chills', icon: 'snow-outline' },
      { id: 'hot_flashes', label: 'Hot flashes', icon: 'flame-outline' },
      { id: 'sweating', label: 'Sweating', icon: 'water-outline' },
      { id: 'swelling', label: 'Swelling', icon: 'expand-outline' },
      { id: 'weight_gain', label: 'Weight gain', icon: 'speedometer-outline' },
    ],
  },
  {
    id: 'cervix',
    label: 'Cervix',
    items: [
      { id: 'pelvic_pain', label: 'Pelvic pain', icon: 'alert-circle-outline' },
      { id: 'cervical_firmness', label: 'Cervical firmness', icon: 'radio-button-on-outline' },
      { id: 'cervical_opening', label: 'Cervical opening', icon: 'radio-button-off-outline' },
      { id: 'cervical_mucus', label: 'Cervical mucus', icon: 'rainy-outline' },
      { id: 'flow', label: 'Flow', icon: 'water' },
      { id: 'spotting', label: 'Spotting', icon: 'ellipse' },
      { id: 'irritation', label: 'Irritation', icon: 'warning-outline' },
    ],
  },
  {
    id: 'fluid',
    label: 'Fluid',
    items: [
      { id: 'fluid_dry', label: 'Dry', icon: 'sunny-outline' },
      { id: 'fluid_sticky', label: 'Sticky', icon: 'magnet-outline' },
      { id: 'fluid_creamy', label: 'Creamy', icon: 'cloud-outline' },
      { id: 'fluid_watery', label: 'Watery', icon: 'water-outline' },
      { id: 'fluid_egg_white', label: 'Egg White', icon: 'egg-outline' },
      { id: 'fluid_cottage_cheese', label: 'Cottage-cheese', icon: 'apps-outline' },
      { id: 'fluid_green', label: 'Green', icon: 'leaf-outline' },
      { id: 'fluid_with_blood', label: 'With blood', icon: 'water' },
      { id: 'fluid_foul_smelling', label: 'Foul-Smelling', icon: 'close-circle-outline' },
    ],
  },
  {
    id: 'abdomen',
    label: 'Abdomen',
    items: [
      { id: 'bloating', label: 'Bloating', icon: 'balloon-outline' },
      { id: 'constipation', label: 'Constipation', icon: 'remove-circle-outline' },
      { id: 'diarrhea', label: 'Diarrhea', icon: 'repeat-outline' },
      { id: 'nausea', label: 'Nausea', icon: 'sad-outline' },
      { id: 'abdominal_cramps', label: 'Abdominal cramps', icon: 'flash-outline' },
      { id: 'dyspepsia', label: 'Dyspepsia', icon: 'flame-outline' },
      { id: 'gas', label: 'Gas', icon: 'cloudy-outline' },
      { id: 'hunger', label: 'Hunger', icon: 'restaurant-outline' },
      { id: 'cravings', label: 'Cravings', icon: 'ice-cream-outline' },
      { id: 'ovulation_pain', label: 'Ovulation pain', icon: 'aperture-outline' },
    ],
  },
  {
    id: 'mental',
    label: 'Mental',
    items: [
      { id: 'anxiety', label: 'Anxiety', icon: 'alert-outline' },
      { id: 'insomnia', label: 'Insomnia', icon: 'moon-outline' },
      { id: 'stress', label: 'Stress', icon: 'speedometer-outline' },
      { id: 'moodiness', label: 'Moodiness', icon: 'swap-vertical-outline' },
      { id: 'tension', label: 'Tension', icon: 'git-compare-outline' },
      { id: 'irritability', label: 'Irritability', icon: 'flame-outline' },
      { id: 'unable_to_concentrate', label: 'Unable to concentrate', icon: 'help-circle-outline' },
      { id: 'fatigue', label: 'Fatigue', icon: 'battery-dead-outline' },
      { id: 'confusion', label: 'Confusion', icon: 'shuffle-outline' },
    ],
  },
  {
    id: 'other',
    label: 'Other',
    items: [
      { id: 'pms', label: 'PMS', icon: 'calendar-outline' },
      { id: 'appetite_loss', label: 'Appetite loss', icon: 'nutrition-outline' },
      { id: 'libido_change', label: 'Libido change', icon: 'heart-outline' },
    ],
  },
];

/** Flat id -> {label, icon, group} lookup, for rendering a saved log back. */
export const SYMPTOMS_BY_ID = Object.fromEntries(
  SYMPTOM_GROUPS.flatMap((group) =>
    group.items.map((item) => [item.id, { ...item, group: group.id, groupLabel: group.label }])
  )
);

// The Add Mood grid. Same four-column chip layout, one flat list — the
// reference app does not group moods.
export const MOODS = [
  { id: 'happy', label: 'Happy', icon: 'happy-outline' },
  { id: 'calm', label: 'Calm', icon: 'leaf-outline' },
  { id: 'energetic', label: 'Energetic', icon: 'flash-outline' },
  { id: 'excited', label: 'Excited', icon: 'sparkles-outline' },
  { id: 'loved', label: 'Loved', icon: 'heart-outline' },
  { id: 'grateful', label: 'Grateful', icon: 'gift-outline' },
  { id: 'confident', label: 'Confident', icon: 'trophy-outline' },
  { id: 'playful', label: 'Playful', icon: 'game-controller-outline' },
  { id: 'romantic', label: 'Romantic', icon: 'rose-outline' },
  { id: 'hopeful', label: 'Hopeful', icon: 'sunny-outline' },
  { id: 'proud', label: 'Proud', icon: 'ribbon-outline' },
  { id: 'relaxed', label: 'Relaxed', icon: 'cafe-outline' },
  { id: 'focused', label: 'Focused', icon: 'locate-outline' },
  { id: 'creative', label: 'Creative', icon: 'color-palette-outline' },
  { id: 'social', label: 'Social', icon: 'people-outline' },
  { id: 'silly', label: 'Silly', icon: 'balloon-outline' },
  { id: 'neutral', label: 'Neutral', icon: 'remove-outline' },
  { id: 'tired', label: 'Tired', icon: 'bed-outline' },
  { id: 'sleepy', label: 'Sleepy', icon: 'moon-outline' },
  { id: 'restless', label: 'Restless', icon: 'infinite-outline' },
  { id: 'bored', label: 'Bored', icon: 'hourglass-outline' },
  { id: 'distracted', label: 'Distracted', icon: 'shuffle-outline' },
  { id: 'moody', label: 'Moody', icon: 'swap-vertical-outline' },
  { id: 'sensitive', label: 'Sensitive', icon: 'heart-half-outline' },
  { id: 'irritable', label: 'Irritable', icon: 'flame-outline' },
  { id: 'angry', label: 'Angry', icon: 'thunderstorm-outline' },
  { id: 'frustrated', label: 'Frustrated', icon: 'close-circle-outline' },
  { id: 'anxious', label: 'Anxious', icon: 'alert-outline' },
  { id: 'stressed', label: 'Stressed', icon: 'speedometer-outline' },
  { id: 'overwhelmed', label: 'Overwhelmed', icon: 'layers-outline' },
  { id: 'sad', label: 'Sad', icon: 'sad-outline' },
  { id: 'lonely', label: 'Lonely', icon: 'person-outline' },
  { id: 'insecure', label: 'Insecure', icon: 'help-circle-outline' },
  { id: 'guilty', label: 'Guilty', icon: 'lock-closed-outline' },
  { id: 'numb', label: 'Numb', icon: 'ellipse-outline' },
  { id: 'feeling_low', label: 'Feeling low', icon: 'trending-down-outline' },
];

export const MOODS_BY_ID = Object.fromEntries(MOODS.map((m) => [m.id, m]));

// Flow, on the daily log sheet. The reference app's fourth step is called
// "Disaster" — kept verbatim, and the column CHECK allows it.
export const FLOW_LEVELS = [
  { id: 'spotting', label: 'Spotting', drops: 1 },
  { id: 'light', label: 'Light', drops: 1 },
  { id: 'medium', label: 'Medium', drops: 2 },
  { id: 'heavy', label: 'Heavy', drops: 3 },
  { id: 'disaster', label: 'Disaster', drops: 4 },
];

export const SEX_DRIVE_LEVELS = [
  { id: 'none', label: 'None', icon: 'remove-outline' },
  { id: 'low', label: 'Low', icon: 'heart-dislike-outline' },
  { id: 'medium', label: 'Medium', icon: 'heart-half-outline' },
  { id: 'high', label: 'High', icon: 'heart-outline' },
];

export const PHASE_META = {
  menstrual: { label: 'Menstrual', tone: 'period', icon: 'water', blurb: 'is on her period. Be gentle, be patient, and check in often.' },
  follicular: { label: 'Follicular', tone: 'success', icon: 'leaf', blurb: 'is in the follicular phase. Energy is climbing — good days to make plans.' },
  ovulation: { label: 'Ovulation', tone: 'fertility', icon: 'sparkles', blurb: 'is in the ovulation period. Stay close, communicate, and be emotionally present!' },
  luteal: { label: 'Luteal', tone: 'accentIndigo', icon: 'moon', blurb: 'is in the luteal phase. Comfort, calm and a little extra care go a long way.' },
};

/** How many of the grid's chips are currently chosen, for the section badge. */
export function countChosen(ids, group) {
  const set = new Set(ids || []);
  return group.items.filter((item) => set.has(item.id)).length;
}
