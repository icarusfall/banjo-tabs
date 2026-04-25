import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn('[db] DATABASE_URL is not set — DB calls will fail.');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') || process.env.NODE_ENV === 'production'
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
