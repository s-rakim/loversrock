import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

export const dateIdeasRouter = Router();

// GET /date-ideas?category=&cost_tier= — browse global curated list (pair_id IS NULL).
dateIdeasRouter.get("/", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});

// GET /date-ideas/saved — this pair's saved ideas (pair_id = pair.id).
dateIdeasRouter.get("/saved", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});

// POST /date-ideas/:id/save — copies the global row into a new pair-scoped row.
// No separate is_saved flag — presence of pair_id on the copied row IS the saved state.
dateIdeasRouter.post("/:id/save", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});

// POST /date-ideas/:id/complete — marks done, optionally creates a Memory with
// taken_at = completion date (not the idea's original creation date, per SPEC.md 5.3).
dateIdeasRouter.post("/:id/complete", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});
