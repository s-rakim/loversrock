import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const seedDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed');
const cache = {};

// Static content that lives in seed/*.json and is read straight from disk
// rather than copied into a table (challenges, Who's More Likely prompts).
export function loadSeed(name) {
  if (!cache[name]) cache[name] = JSON.parse(readFileSync(join(seedDir, name), 'utf8'));
  return cache[name];
}

// Small deterministic hash so "today's pick" is stable for a pair all day
// without storing it.
export function stableHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function isoWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
