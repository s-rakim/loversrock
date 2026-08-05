import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

export const messagesRouter = Router();

// GET /messages — full thread, ordered by sent_at, includes text/photo/doodle types.
// reply_to_message_id lets doodle replies render with the parent doodle as context.
messagesRouter.get("/", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});

// POST /messages — type: 'text' | 'photo' | 'doodle'.
// For photo/doodle: client uploads image first (see memories.js pattern), then
// creates the message row with the resulting image_url.
// After insert: fire FCM notification to partner's devices.
messagesRouter.post("/", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});

// PATCH /messages/:id/seen — sets seen_at.
messagesRouter.patch("/:id/seen", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});
