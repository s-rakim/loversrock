import cron from "node-cron";
import { query } from "../config/db.js";
import { minioClient, BUCKET } from "../config/storage.js";
import { sendNotification } from "../config/firebase.js";

// NOTE: node-cron running inside the single backend process is fine for MVP.
// If the container restarts mid-job or you need reliability guarantees beyond
// "roughly once a day," migrate to BullMQ + Redis as a separate worker (SPEC.md 9.4).

export function startCronJobs() {
  // Hard-delete memories soft-deleted more than 30 days ago, including their
  // MinIO objects. Without this, storage leaks silently (SPEC.md 5.1).
  cron.schedule("0 3 * * *", async () => {
    const { rows } = await query(
      `SELECT id, image_url FROM memories WHERE deleted_at < now() - interval '30 days'`
    );
    for (const row of rows) {
      const key = row.image_url.split("/").pop();
      await minioClient.removeObject(BUCKET, key).catch((err) => {
        console.error(`Failed to remove MinIO object for memory ${row.id}:`, err.message);
      });
    }
    if (rows.length > 0) {
      await query(
        `DELETE FROM memories WHERE deleted_at < now() - interval '30 days'`
      );
      console.log(`Cleaned up ${rows.length} expired soft-deleted memories.`);
    }
  });

  // Warn if the quiz question bank is running low (SPEC.md 4.3 / seed 90 days ahead).
  cron.schedule("0 4 * * *", async () => {
    const { rows } = await query(
      `SELECT COUNT(DISTINCT scheduled_date) AS days_remaining
       FROM quiz_questions WHERE scheduled_date >= CURRENT_DATE`
    );
    const daysRemaining = parseInt(rows[0]?.days_remaining || "0", 10);
    if (daysRemaining < 7) {
      console.warn(
        `⚠️  Quiz question bank has only ${daysRemaining} day(s) of content left. ` +
          `Add more rows to seed/quiz_questions.json and re-run npm run seed.`
      );
    }
  });

  // Weekly: push one random unsaved global date idea to every active pair (SPEC.md Feature 6).
  cron.schedule("0 10 * * 1", async () => {
    const { rows: pairs } = await query(`SELECT * FROM pairs WHERE unlinked_at IS NULL`);
    for (const pair of pairs) {
      const { rows: ideaRows } = await query(
        `SELECT * FROM date_ideas WHERE pair_id IS NULL ORDER BY random() LIMIT 1`
      );
      const idea = ideaRows[0];
      if (!idea) continue;
      const { rows: devices } = await query(
        `SELECT ud.fcm_token FROM user_devices ud
         JOIN users u ON u.id = ud.user_id
         WHERE u.id = $1 OR u.id = $2`,
        [pair.user_a_id, pair.user_b_id]
      );
      await sendNotification(
        devices.map((d) => d.fcm_token),
        "New date idea 💡",
        idea.title
      );
    }
  });

  console.log("Cron jobs scheduled: memory cleanup (3am), quiz bank check (4am), weekly date idea (Mon 10am).");
}
