import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

export const widgetPhotosRouter = Router();

// POST /widget-photos — upload flow same as memories.js, but ALSO:
// 1. insert widget_photos row
// 2. insert a mirrored memories row (source='widget') so it shows in the normal feed too
// 3. sendDataMessage() (see config/firebase.js) to partner's Android devices with the image URL
//
// IMPORTANT reliability caveat (docs/SPEC.md Feature 8):
// FCM data messages do NOT reliably wake a force-stopped app, and several Android
// OEMs (Xiaomi/Oppo/Samsung) kill background delivery unless the app is whitelisted.
// The Android widget code (native, separate from this backend) MUST cache the last
// photo locally and show it with a "tap to refresh" fallback — never assume this
// push arrives. This endpoint should not be the ONLY way a photo reaches the partner;
// the mirrored memories/messages entry above is the reliable fallback path.
widgetPhotosRouter.post("/", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});

// GET /widget-photos/latest — used by the Android widget's WorkManager job as a
// pull-based fallback when the push never arrived.
widgetPhotosRouter.get("/latest", requireAuth, async (req, res) => {
  return res.status(501).json({ error: "TODO" });
});
