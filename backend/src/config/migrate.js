import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const schemaSql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  console.log("Applying schema.sql...");
  await pool.query(schemaSql);
  console.log("Schema applied successfully.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
