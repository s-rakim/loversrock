// The daily question: one for every day of the year, from our own list
// (seed/daily_prompts.json, 365 questions), with AI and the web sources only
// as a backup.
//
// Each date gets the question for its day of the year, so the same day brings
// the same question every year and no two days in a year repeat. Every start
// and every night (cron/index.js) lays the next month out from the list.
// A day that already has a question from somewhere else — AI, the web, an
// older seed — goes back to the list's question, but only while nobody has
// answered it: a question either of you has started is never changed under
// you.
//
// The backup is for the days the list cannot cover: its question for that
// date is already on another date close by (after an edit to the list, say).
// Those days go to fetchQuestions, which asks the AI connector first, then
// the web sources, then whatever else is in the local files.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../config/db.js';

const here = dirname(fileURLToPath(import.meta.url));
export const BANK_SOURCE = 'bank';

let bank = null;
/** The 365 questions, in day-of-year order. */
export function promptBank() {
  if (!bank) {
    const rows = JSON.parse(readFileSync(join(here, '../../seed/daily_prompts.json'), 'utf8'));
    bank = rows
      .filter((r) => r?.content)
      .sort((a, b) => (a.day ?? 0) - (b.day ?? 0))
      .map((r) => ({ category: r.category || 'connection', content: r.content }));
  }
  return bank;
}

const DAY_MS = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (date, n) => iso(new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY_MS));

/** Day of the year, 1-366. */
export function dayOfYear(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS) + 1;
}

/** The list's question for a date. Day 366 of a leap year wraps to day 1. */
export function bankQuestionFor(date) {
  const list = promptBank();
  return list[(dayOfYear(date) - 1) % list.length];
}

/**
 * Lays the list's questions onto yesterday (UTC) through `ahead` days out.
 * Yesterday because a pair west of UTC is still on it for part of the day.
 * Returns what it did, and the dates it could not fill for the backup.
 */
export async function applyPromptBank({ today = new Date(), ahead = 30 } = {}) {
  const start = addDays(iso(today), -1);
  const end = addDays(iso(today), ahead);

  const { rows } = await query(
    `SELECT p.id, p.scheduled_date::text AS date, p.content, p.source,
            EXISTS (SELECT 1 FROM prompt_responses r WHERE r.prompt_id = p.id) AS answered
       FROM daily_prompts p
      WHERE p.scheduled_date BETWEEN $1::date - 180 AND $2::date + 180`,
    [start, end]
  );
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  // Where each question already sits, to never put one on two nearby dates.
  const placed = new Map(rows.map((r) => [norm(r.content), r.date]));

  let added = 0;
  let restored = 0;
  const backup = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const want = bankQuestionFor(date);
    const current = byDate.get(date);
    if (current && (current.answered || norm(current.content) === norm(want.content))) continue;

    const elsewhere = placed.get(norm(want.content));
    if (elsewhere && elsewhere !== date) {
      if (!current) backup.push(date);
      continue;
    }

    if (!current) {
      const { rowCount } = await query(
        `INSERT INTO daily_prompts (scheduled_date, category, content, source)
         VALUES ($1, $2, $3, $4) ON CONFLICT (scheduled_date) DO NOTHING`,
        [date, want.category, want.content, BANK_SOURCE]
      );
      added += rowCount;
    } else {
      // Not answered by either of you (checked above): back to the list.
      await query('DELETE FROM prompt_follow_up_picks WHERE prompt_id = $1', [current.id]);
      const { rowCount } = await query(
        `UPDATE daily_prompts SET category = $2, content = $3, source = $4
          WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM prompt_responses WHERE prompt_id = $1)`,
        [current.id, want.category, want.content, BANK_SOURCE]
      );
      restored += rowCount;
      placed.delete(norm(current.content));
    }
    placed.set(norm(want.content), date);
  }
  return { added, restored, backup };
}
