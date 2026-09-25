// The seed runner's SQL.
//
// Written after shipping `INSERT INTO games_catalog (slug, emoji, title,
// subtitle, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)` — a five-column
// insert with seven placeholders, left behind when the two paywall columns
// were dropped and the column list and the parameter array were updated but
// the line between them was not.
//
// It is the kind of mistake that is invisible to every other test in this
// repo: the routes are all fine, the schema is fine, and the only thing that
// breaks is a fresh `npm run seed` on somebody else's machine. So this parses
// the SQL out of the runner and checks the three counts agree.
import fs from 'node:fs';
import path from 'node:path';

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${d ?? ''}`); } };

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const runner = fs.readFileSync(path.join(root, 'seed', 'run-seed.js'), 'utf8');

console.log('=== EVERY INSERT AGREES WITH ITSELF ===');

// INSERT INTO <table> (<columns>) ... VALUES (<placeholders>)
const inserts = [...runner.matchAll(
  /INSERT INTO (\w+)\s*\(([^)]*)\)\s*(?:--[^\n]*\n\s*)*VALUES\s*\(([^)]*)\)/g
)];

check(`found ${inserts.length} INSERT statements`, inserts.length >= 6, inserts.length);

for (const [, table, columnList, valueList] of inserts) {
  const columns = columnList.split(',').map((c) => c.trim()).filter(Boolean);
  // Distinct, because a placeholder may legitimately be reused — the
  // check-in upsert passes $2 for two different things.
  const placeholders = new Set(valueList.match(/\$\d+/g) || []);
  check(
    `${table}: ${columns.length} columns, ${placeholders.size} placeholders`,
    columns.length === placeholders.size,
    { columns, placeholders: [...placeholders] }
  );
}

console.log('\n=== AND WITH THE PARAMETER ARRAY IT IS GIVEN ===');
// The array literal that follows each query, counted the same way. A
// mismatch here is the other half of the same bug: right SQL, wrong arity.
const calls = [...runner.matchAll(
  /INSERT INTO (\w+)[\s\S]*?`,\s*\n?\s*\[([\s\S]*?)\]\s*\n?\s*\);/g
)];
for (const [whole, table, args] of calls) {
  const placeholders = new Set(whole.match(/\$\d+/g) || []);
  // Split on top-level commas only — an argument can itself contain one,
  // e.g. JSON.stringify({ a, b }) or a ternary. Empty segments are dropped
  // so a trailing comma on a multi-line array is not counted as an argument,
  // which is the normal way these are written.
  const segments = [];
  let depth = 0; let current = '';
  for (const ch of args) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { segments.push(current); current = ''; continue; }
    current += ch;
  }
  segments.push(current);
  const count = segments.map((x) => x.trim()).filter(Boolean).length;
  check(`${table}: ${placeholders.size} placeholders, ${count} arguments`,
    placeholders.size === count, { placeholders: [...placeholders], args: args.trim() });
}

console.log('\n=== THE DROPPED PAYWALL COLUMNS ARE NOT REFERENCED ===');
// Seeding a column the schema no longer has is the same failure from the
// other direction.
for (const column of ['is_locked', 'is_implemented']) {
  check(`the seed runner never mentions ${column}`, !runner.includes(column));
}
for (const file of ['question_decks.json', 'games_catalog.json']) {
  const json = fs.readFileSync(path.join(root, 'seed', file), 'utf8');
  check(`${file} carries no lock flag`, !/isLocked|isImplemented/.test(json));
}

console.log(`\nSEED RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
