import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

export const bucketListRouter = Router();

// GET /bucket-list — all items for the pair, split completed/active client-side or here.
bucketListRouter.get("/", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});

// POST /bucket-list — create item. After insert, emit `bucket:update` to the pair's
// Socket.io room (see src/sockets/index.js) so the partner sees it live if online.
// REST is still the source of truth — client also refetches on app foreground.
bucketListRouter.post("/", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});

// PATCH /bucket-list/:id — toggle is_completed, set completed_at, emit `bucket:update`.
bucketListRouter.patch("/:id", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});

// POST /bucket-list/:id/convert-to-memory — prefill a Memory with this item's title.
bucketListRouter.post("/:id/convert-to-memory", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});
