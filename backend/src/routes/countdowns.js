import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

export const countdownsRouter = Router();

// GET /countdowns — active (non-archived) countdowns, soonest first.
// Display math should happen client-side relative to pair.timezone, not device timezone.
countdownsRouter.get("/", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});

// POST /countdowns — target_date (timestamptz) + label.
countdownsRouter.post("/", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});

// DELETE /countdowns/:id
countdownsRouter.delete("/:id", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});
