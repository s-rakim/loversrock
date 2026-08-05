import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Small helper so route files don't need to import `pool` everywhere.
export async function query(text, params) {
  return pool.query(text, params);
}
