import pg from "pg";

const { Pool } = pg;

// Shared connection pool configured from the PG* env vars (see .env.example).
export const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD || undefined,
  database: process.env.PGDATABASE || "worldcup",
  max: 10,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});

// Wrapper to keep every caller on parameterized queries ($1, $2, ...).
export function query(text, params) {
  return pool.query(text, params);
}
