// The pure halves of the distance widget: who is which mascot picture, and
// which emoji a home screen may show. No server needed.
import { resolveMascotArt } from '../src/models/mascotArt.js';
import { MOOD_EMOJI, SYMPTOM_EMOJI, moodEmoji, symptomEmoji } from '../src/models/widgetEmoji.js';
import { MOODS } from '../src/routes/presence.js';

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('=== WHO IS WHICH PICTURE ===');
const both = (me, partner, creator) => {
  const mine = resolveMascotArt(me, partner, creator);
  const theirs = resolveMascotArt(partner, me, !creator);
  return { mine, theirs };
};
const agree = ({ mine, theirs }) => mine.mine !== mine.theirs && mine.mine === theirs.theirs && mine.theirs === theirs.mine;

for (const [label, me, partner] of [
  ['nothing known', {}, {}],
  ['only I picked', { art: 'b' }, {}],
  ['only they picked', {}, { art: 'b' }],
  ['only roles', { cycleRole: 'owner' }, { cycleRole: 'partner' }],
  ['one role', {}, { cycleRole: 'owner' }],
  ['a pick and a role', { art: 'a' }, { cycleRole: 'partner' }],
]) {
  for (const creator of [true, false]) {
    check(`${label} (creator=${creator}): two phones, two pictures, same answer`, agree(both(me, partner, creator)), both(me, partner, creator));
  }
}
check('my own pick wins', resolveMascotArt({ art: 'b', cycleRole: 'partner' }, {}, true).mine === 'b');
check("their pick decides mine", resolveMascotArt({ cycleRole: 'owner' }, { art: 'b' }, true).mine === 'a');
check('the person tracking their own cycle is b', resolveMascotArt({ cycleRole: 'owner' }, {}, true).mine === 'b');
check("their role decides mine", resolveMascotArt({}, { cycleRole: 'owner' }, true).mine === 'a');
check('with nothing to go on, the creator is a', resolveMascotArt({}, {}, true).mine === 'a' && resolveMascotArt({}, {}, false).mine === 'b');
check('garbage is ignored, not trusted', resolveMascotArt({ art: 'z', cycleRole: 'x' }, null, true).mine === 'a');
// Both picked the same picture: each phone keeps its own choice for "me", so
// neither phone draws the same picture twice.
const clash = resolveMascotArt({ art: 'a' }, { art: 'a' }, true);
check('if both pick the same picture, one phone still never shows it twice', clash.mine !== clash.theirs, clash);

console.log('\n=== THE EMOJI MAP COVERS EVERYTHING THE APP CAN LOG ===');
const catalog = await import('../../mobile/data/cycleCatalog.js');
const ids = catalog.SYMPTOM_GROUPS.flatMap((g) => g.items.map((i) => i.id));
const missing = ids.filter((id) => !Object.hasOwn(SYMPTOM_EMOJI, id));
check('every symptom the app offers is decided: an emoji, or never', missing.length === 0, missing);
const stale = Object.keys(SYMPTOM_EMOJI).filter((id) => !ids.includes(id));
check('and nothing in the map that the app no longer offers', stale.length === 0, stale);
check('every mood the mood bar offers has an emoji', MOODS.every((m) => typeof MOOD_EMOJI[m] === 'string'), MOODS.filter((m) => !MOOD_EMOJI[m]));

const NEVER = ['flow', 'spotting', 'cervical_mucus', 'cervical_opening', 'cervical_firmness', 'fluid_green', 'fluid_with_blood',
  'tender_breasts', 'breast_sensitivity', 'pms', 'ovulation_pain', 'libido_change', 'pelvic_pain', 'diarrhea', 'constipation'];
check('the intimate ones are never shown', NEVER.every((id) => SYMPTOM_EMOJI[id] === null), NEVER.filter((id) => SYMPTOM_EMOJI[id] !== null));

console.log('\n=== LOOKUPS ===');
check('mood lookup', moodEmoji('loved') === '🥰' && moodEmoji('nope') === null && moodEmoji(null) === null);
check('prototype keys are not emoji', moodEmoji('constructor') === null && same(symptomEmoji(['constructor', '__proto__', 'toString']), []));
check('symptoms: order kept, repeats collapsed, intimate dropped, capped at 3',
  same(symptomEmoji(['backache', 'flow', 'neck_ache', 'headache', 'cramps', 'nausea']), ['💢', '🤕', '😖']));
check('non-array input is an empty row', same(symptomEmoji(null), []) && same(symptomEmoji(undefined), []));

console.log(`\nWIDGET MASCOTS RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log('FAILURES:', fails); process.exit(1); }
