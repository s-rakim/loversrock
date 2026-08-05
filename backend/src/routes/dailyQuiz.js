import { Router } from "express";
import { query } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { getActivePairForUser } from "../models/pairs.js";

export const dailyQuizRouter = Router();

// GET /quiz/today — returns today's 5 questions + this user's progress.
// See docs/SPEC.md "Correctness state machine" before implementing scoring.
dailyQuizRouter.get("/today", requireAuth, async (req, res) => {
  const pair = await getActivePairForUser(req.userId);
  if (!pair) return res.status(400).json({ error: "You don't have a partner linked yet" });

  // TODO: compute today's date in pair.timezone (see dailyPrompt.js todayInTimezone
  // for the pattern — consider extracting it to a shared util).
  // TODO: SELECT the 5 quiz_questions rows for today, ordered by question_order.
  // TODO: SELECT this user's quiz_attempts for those question_ids.
  // TODO: for guess_partner questions, only include the correct_answer/partner's
  // answer in the response once BOTH attempts exist (mirror dailyPrompt.js's
  // reveal-after-both pattern) — do not leak it early.
  return res.status(501).json({ error: "Not implemented — see TODOs in this file" });
});

// POST /quiz/:questionId/respond
// TODO: insert/upsert quiz_attempts row, state starts 'pending'.
// TODO: if type is trivia/this_or_that, compute is_correct immediately against
//       quiz_questions.correct_answer, set state='computed'.
// TODO: if type is guess_partner: check whether the PAIRED self-description attempt
//       (the partner answering about themselves for this question_order) exists yet.
//       - if not: state='waiting_for_partner'
//       - if yes: compare answers, set is_correct on BOTH rows, state='computed',
//         fire FCM to both (idempotent — check state wasn't already 'computed').
// TODO: when both users have 5 quiz_attempts for today's scheduled_date, the day
//       is complete — no separate flag needed, compute this via COUNT() at read time.
dailyQuizRouter.post("/:questionId/respond", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "Not implemented — see TODOs in this file" });
});

// GET /quiz/archive?month=2026-08 — calendar view, one entry per day with
// completion fraction (e.g. "4/5") and score if fully computed.
dailyQuizRouter.get("/archive", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "Not implemented — see TODOs in this file" });
});
