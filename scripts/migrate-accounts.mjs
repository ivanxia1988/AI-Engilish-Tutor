import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export async function migrateAccounts(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('teeko-account-migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS teeko_schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = new URL('../db/migrations/', import.meta.url);
    const names = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort();
    for (const name of names) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query('SELECT checksum FROM teeko_schema_migrations WHERE name=$1', [name]);
      if (existing.rows.length) {
        if (existing.rows[0].checksum !== checksum) throw new Error('An applied account migration was modified.');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO teeko_schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { await migrateAccounts(process.env.DATABASE_URL); process.stdout.write('Account migrations applied.\n'); }
  catch { process.stderr.write('Account migration failed. Check database configuration and migration state.\n'); process.exitCode = 1; }
}
