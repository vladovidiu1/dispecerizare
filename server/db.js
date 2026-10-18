import pg from "pg";
import { readFile } from "node:fs/promises";
export function connectDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const pool = new pg.Pool({ connectionString, max: 10 });
  pool.on("error", (error) =>
    console.error(
      "PostgreSQL idle connection error:",
      error.code || error.name,
    ),
  );
  return pool;
}
export async function migrate(db) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(73412001)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const [version, file] of [
      ["001", "001_initial.sql"],
      ["002", "002_mail_learning.sql"],
      ["003", "003_workflows.sql"],
    ]) {
      if (
        !(
          await c.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
            version,
          ])
        ).rowCount
      ) {
        await c.query(
          await readFile(
            new URL("./migrations/" + file, import.meta.url),
            "utf8",
          ),
        );
        await c.query("INSERT INTO schema_migrations(version) VALUES($1)", [
          version,
        ]);
      }
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function transaction(db, fn) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
