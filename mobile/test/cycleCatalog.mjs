// Checks the cycle catalogue without a device.
//
// Two things here only fail at runtime otherwise, on a screen nobody opens
// during a smoke test: a duplicate id silently makes two chips toggle each
// other, and an Ionicons name that does not exist renders as a blank box.
import fs from 'node:fs';
import path from 'node:path';

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${d ?? ''}`); } };

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const {
  SYMPTOM_GROUPS, SYMPTOMS_BY_ID, MOODS, MOODS_BY_ID,
  FLOW_LEVELS, SEX_DRIVE_LEVELS, PHASE_META, countChosen,
} = await import(path.join(root, 'data', 'cycleCatalog.js'));

const glyphs = JSON.parse(fs.readFileSync(
  path.join(root, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'),
  'utf8'
));

console.log('=== THE SCREENSHOTS ARE COVERED ===');
const groupIds = SYMPTOM_GROUPS.map((g) => g.id);
for (const required of ['head', 'body', 'cervix', 'fluid', 'abdomen', 'mental']) {
  check(`the ${required} group exists`, groupIds.includes(required), groupIds.join(', '));
}

// A sample from each screenshot, by label, so a rename that drops one is loud.
const labels = new Set(Object.values(SYMPTOMS_BY_ID).map((s) => s.label));
for (const label of [
  'Headache', 'Migraines', 'Dizziness', 'Acne', 'Hectic fever',
  'Tender breasts', 'Backaches', 'Low back pain', 'Muscle pain', 'Cramps',
  'Pelvic pain', 'Cervical firmness', 'Cervical opening', 'Cervical mucus', 'Spotting',
  'Dry', 'Sticky', 'Creamy', 'Watery', 'Egg White', 'Cottage-cheese', 'Foul-Smelling',
  'Bloating', 'Constipation', 'Diarrhea', 'Nausea', 'Gas', 'Cravings', 'Ovulation pain',
  'Anxiety', 'Insomnia', 'Stress', 'Moodiness', 'Irritability', 'Unable to concentrate',
  'Fatigue', 'Confusion', 'PMS', 'Weight gain',
]) {
  check(`"${label}" is in the catalogue`, labels.has(label));
}

console.log('\n=== IDS ARE UNIQUE AND STABLE ===');
const symptomIds = SYMPTOM_GROUPS.flatMap((g) => g.items.map((i) => i.id));
check('no duplicate symptom id', new Set(symptomIds).size === symptomIds.length,
  symptomIds.filter((id, i) => symptomIds.indexOf(id) !== i).join(', '));
const moodIds = MOODS.map((m) => m.id);
check('no duplicate mood id', new Set(moodIds).size === moodIds.length,
  moodIds.filter((id, i) => moodIds.indexOf(id) !== i).join(', '));
check('lookup covers every symptom', Object.keys(SYMPTOMS_BY_ID).length === symptomIds.length);
check('lookup covers every mood', Object.keys(MOODS_BY_ID).length === moodIds.length);
check('ids are snake_case ascii',
  [...symptomIds, ...moodIds].every((id) => /^[a-z0-9_]+$/.test(id)),
  [...symptomIds, ...moodIds].filter((id) => !/^[a-z0-9_]+$/.test(id)).join(', '));

console.log('\n=== EVERY GLYPH EXISTS IN IONICONS ===');
const withIcons = [
  ...SYMPTOM_GROUPS.flatMap((g) => g.items),
  ...MOODS,
  ...SEX_DRIVE_LEVELS,
  ...Object.values(PHASE_META),
];
const missing = withIcons.filter((item) => !(item.icon in glyphs));
check(`all ${withIcons.length} glyph names resolve`, missing.length === 0,
  missing.map((m) => `${m.label || m.id}: ${m.icon}`).join(', '));

console.log('\n=== NO EMOJI SNUCK IN ===');
const source = fs.readFileSync(path.join(root, 'data', 'cycleCatalog.js'), 'utf8');
// Pictographic ranges only — the file's own prose uses em dashes and quotes.
const emoji = source.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || [];
check('the catalogue is emoji-free, per components/Icon.js', emoji.length === 0, emoji.join(' '));

console.log('\n=== FLOW MATCHES THE COLUMN CHECK ===');
const allowed = ['spotting', 'light', 'medium', 'heavy', 'disaster'];
check('every flow level is one the backend accepts',
  FLOW_LEVELS.every((l) => allowed.includes(l.id)),
  FLOW_LEVELS.map((l) => l.id).join(', '));
check('drop counts rise with intensity',
  FLOW_LEVELS.every((l, i) => i === 0 || l.drops >= FLOW_LEVELS[i - 1].drops));
check('sex drive levels match the backend enum',
  SEX_DRIVE_LEVELS.map((l) => l.id).join(',') === 'none,low,medium,high');

console.log('\n=== COUNTING ===');
check('countChosen counts only its own group',
  countChosen(['headache', 'bloating'], SYMPTOM_GROUPS.find((g) => g.id === 'head')) === 1);
check('countChosen tolerates no selection', countChosen(undefined, SYMPTOM_GROUPS[0]) === 0);

console.log(`\nCATALOGUE RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
