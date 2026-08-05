import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

export const memoriesRouter = Router();

// GET /memories — chronological feed, WHERE deleted_at IS NULL, includes source='widget' entries.
memoriesRouter.get("/", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO: paginated feed, see docs/SPEC.md Feature 4" });
});

// POST /memories — multipart upload -> compress -> minioClient.putObject -> insert row.
// See src/config/storage.js for the MinIO client.
memoriesRouter.post("/", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO: image upload flow" });
});

// PATCH /memories/:id — edit caption/date, or set deleted_at (soft-delete, 30-day undo).
// Either partner may restore during the window — do not restrict to original uploader.
memoriesRouter.patch("/:id", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});

// POST /memories/:id/restore — clears deleted_at if within 30 days.
memoriesRouter.post("/:id/restore", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});
