// Every string key the app asks for must exist in all four languages.
// Checks literal t('key') calls in the source, plus the dynamic key families
// (moods, wardrobe items, statuses, …) expanded from their real data.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from '../i18n/en.js';
import fr from '../i18n/fr.js';
import es from '../i18n/es.js';
import de from '../i18n/de.js';
import { MOODS, EMOTIONS } from '../components/moods.js';
import { HAIR_STYLES, TOP_STYLES, BOTTOM_STYLES, SHOE_STYLES, ACCESSORIES, PRESETS } from '../components/avatar/wardrobe.js';

const dicts = { en, fr, es, de };
const fails = [];
let checked = 0;

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === 'node_modules' || f.startsWith('.')) return [];
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

const used = new Set();
for (const file of [...walk('app'), ...walk('components'), 'App.js']) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/'((?:home\.link|onboarding\.tailor)[a-zA-Z0-9_.]*)'/g)) used.add(m[1]);
}

const families = {
  'mood.': MOODS.map((m) => m.key),
  'emotion.': EMOTIONS,
  'onboarding.character.': Object.keys(PRESETS),
  'onboarding.rel.': ['dating', 'engaged', 'married', 'long_distance', 'living_together', 'its_complicated'],
  'onboarding.goal.': ['communication', 'fun', 'intimacy', 'quality_time', 'memories', 'long_distance', 'growth', 'adventure'],
  'onboarding.found.': ['partner', 'friend', 'social', 'search', 'other'],
  'wardrobe.': ['body', 'hair', 'top', 'bottom', 'shoes', 'extras'],
  'wardrobe.hair.': HAIR_STYLES.map((h) => h.key),
  'wardrobe.top.': TOP_STYLES.map((h) => h.key),
  'wardrobe.bottom.': BOTTOM_STYLES.map((h) => h.key),
  'wardrobe.shoes.': SHOE_STYLES.map((h) => h.key),
  'wardrobe.acc.': ACCESSORIES.map((h) => h.key),
  'loveLanguage.': ['words', 'quality_time', 'gifts', 'acts', 'touch'],
  'favorite.': ['food', 'movie', 'song', 'place', 'colour'],
  'dates.setting.': ['city', 'suburbs', 'rural', 'long_distance'],
  'dates.status.': ['idea', 'planned', 'confirmed', 'done', 'cancelled'],
  'dates.category.': ['at_home', 'outdoors', 'culture', 'sentimental', 'going_out', 'splurge', 'long_distance'],
  'checkin.q.': ['connection', 'communication', 'quality_time', 'fun', 'support', 'highlight', 'felt_loved', 'improve', 'looking_forward'],
  'checkin.short.': ['connection', 'communication', 'quality_time', 'fun', 'support'],
  'sparks.reward.': ['prompt_answer', 'prompt_both', 'daily_snap', 'checkin', 'challenge', 'feed_post'],
  'sparks.reason.': ['welcome', 'prompt_answer', 'prompt_both', 'daily_snap', 'checkin', 'challenge', 'feed_post', 'achievement', 'gift_sent', 'gift_received', 'streak_freeze', 'streak_restore', 'unlock', 'game_hint'],
  'notifications.': ['messages', 'mood', 'feed', 'notes', 'secret', 'dates', 'checkins', 'sparks', 'achievements', 'canvas', 'thumbkiss', 'games', 'snaps'],
  'timeline.type.': ['memory', 'snap', 'post', 'date', 'bucket', 'challenge', 'drawing', 'achievement', 'checkin', 'countdown'],
  'challenge.kind.': ['any', 'challenge', 'date', 'game', 'deck'],
  'chess.status.': ['active', 'checkmate', 'stalemate', 'draw', 'resigned'],
  'tab.': ['Home', 'Feed', 'Games', 'Messages', 'Memories', 'Settings'],
};
for (const [prefix, keys] of Object.entries(families)) for (const k of keys) used.add(prefix + k);
for (const k of families['notifications.']) used.add(`notifications.${k}.hint`);

for (const key of used) {
  for (const [lang, dict] of Object.entries(dicts)) {
    checked += 1;
    if (!dict[key]) fails.push(`${lang}: missing "${key}"`);
  }
}
for (const [lang, dict] of Object.entries(dicts)) {
  for (const key of Object.keys(en)) if (!(key in dict)) fails.push(`${lang}: missing "${key}" (present in en)`);
  // Placeholders must survive translation.
  for (const [key, value] of Object.entries(en)) {
    const want = (value.match(/\{\w+\}/g) || []).sort().join();
    const got = ((dict[key] || '').match(/\{\w+\}/g) || []).sort().join();
    if (want !== got) fails.push(`${lang}: "${key}" placeholders ${got || '(none)'} ≠ ${want}`);
  }
}

console.log(`I18N — ${used.size} keys used, ${checked} lookups checked, ${fails.length} problems`);
fails.forEach((f) => console.log('  FAIL', f));
process.exit(fails.length ? 1 : 0);
