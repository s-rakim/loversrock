import pg from 'pg';

const { Pool } = pg;

// Return DATE columns as plain 'YYYY-MM-DD' strings instead of JS Date
// objects. node-postgres otherwise parses them into local-midnight Dates,
// which (a) never compare equal to the date strings this app computes, and
// (b) can shift by a day when the server isn't on UTC. Every DATE column
// here is a calendar day, not an instant, so a string is the honest type.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
