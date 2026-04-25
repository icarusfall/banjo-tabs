import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('[db] DATABASE_URL is not set on this service.');
  console.error('[db] On Railway: open your web service → Variables → Add → choose "Reference"');
  console.error('[db]   → pick the Postgres plugin → DATABASE_URL. Then redeploy.');
  process.exit(1);
}

try {
  const u = new URL(DATABASE_URL);
  console.log(`[db] connecting to ${u.hostname}:${u.port || 5432} as ${u.username}`);
} catch {
  console.error('[db] DATABASE_URL is not a valid URL');
  process.exit(1);
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('railway') || DATABASE_URL.includes('sslmode=require') || process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
});

export async function query(sql, params) {
  return pool.query(sql, params);
}

export async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS tabs (
      id SERIAL PRIMARY KEY,
      owner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (owner_id, slug)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS tabs_owner_idx ON tabs (owner_id, updated_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS tabs_public_idx ON tabs (visibility, updated_at DESC) WHERE visibility = 'public'`);
}
