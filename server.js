import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { query, initSchema } from './lib/db.js';
import {
  hashPassword, verifyPassword, createSession, destroySession,
  setSessionCookie, clearSessionCookie, parseCookies,
  attachUser, requireAuth, validateSignup,
} from './lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 5174;

await initSchema().catch((e) => {
  console.error('Schema init failed:', e);
  process.exit(1);
});

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(attachUser);
app.use(express.static(PUBLIC, { index: false }));

// ---------- Helpers ----------
function slugify(s) {
  return (s || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

async function uniqueSlug(ownerId, base, excludeSlug = null) {
  let slug = base;
  let n = 2;
  while (true) {
    const { rows } = await query(
      'SELECT 1 FROM tabs WHERE owner_id = $1 AND slug = $2',
      [ownerId, slug]
    );
    if (!rows[0] || slug === excludeSlug) return slug;
    slug = `${base}-${n++}`;
  }
}

function defaultTabData() {
  return {
    tuning: ['D', 'B', 'G', 'D', 'g'],
    capo: 0,
    tempo: 120,
    timeSignature: { num: 4, den: 4 },
    subdivision: 4,
    measures: Array.from({ length: 8 }, () => ({ label: '', notes: {} })),
    notes: '',
  };
}

function tabRowToJson(r) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    artist: r.artist,
    visibility: r.visibility,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
    ...r.data,
  };
}

const VALID_VISIBILITY = new Set(['private', 'unlisted', 'public']);

// ---------- Page routes ----------
app.get('/', (req, res) => {
  if (req.user) return res.redirect('/editor');
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/editor');
  res.sendFile(path.join(PUBLIC, 'login.html'));
});

app.get('/signup', (req, res) => {
  if (req.user) return res.redirect('/editor');
  res.sendFile(path.join(PUBLIC, 'signup.html'));
});

app.get(['/editor', '/editor/:slug'], requireAuth, (_req, res) => {
  res.sendFile(path.join(PUBLIC, 'editor.html'));
});

app.get('/browse', (_req, res) => {
  res.sendFile(path.join(PUBLIC, 'browse.html'));
});

app.get('/u/:username/:slug', (_req, res) => {
  res.sendFile(path.join(PUBLIC, 'view.html'));
});

// ---------- Auth API ----------
app.post('/api/auth/signup', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const err = validateSignup({ email, username, password });
  if (err) return res.status(400).json({ error: err });
  try {
    const { rows } = await query(
      `INSERT INTO users (email, username, password_hash)
       VALUES ($1, $2, $3) RETURNING id, email, username`,
      [email, username, hashPassword(password)]
    );
    const user = rows[0];
    const token = await createSession(user.id);
    setSessionCookie(res, token);
    res.json({ user });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({
        error: e.constraint?.includes('username') ? 'Username already taken' : 'Email already registered',
      });
    }
    console.error('signup error', e);
    res.status(500).json({ error: 'Signup failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const { rows } = await query(
    'SELECT id, email, username, password_hash FROM users WHERE email = $1',
    [email]
  );
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: { id: user.id, email: user.email, username: user.username } });
});

app.post('/api/auth/logout', async (req, res) => {
  const token = parseCookies(req).btab_session;
  await destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not logged in' });
  res.json({ user: req.user });
});

// ---------- Tabs API (owner) ----------
app.get('/api/tabs', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, slug, title, artist, visibility, updated_at, created_at
     FROM tabs WHERE owner_id = $1 ORDER BY updated_at DESC`,
    [req.user.id]
  );
  res.json(rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    artist: r.artist,
    visibility: r.visibility,
    updatedAt: r.updated_at,
  })));
});

app.post('/api/tabs', requireAuth, async (req, res) => {
  const title = String(req.body?.title || 'Untitled').trim() || 'Untitled';
  const artist = String(req.body?.artist || '').trim();
  const slug = await uniqueSlug(req.user.id, slugify(title));
  const data = defaultTabData();
  const { rows } = await query(
    `INSERT INTO tabs (owner_id, slug, title, artist, data)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.id, slug, title, artist, data]
  );
  res.json(tabRowToJson(rows[0]));
});

app.get('/api/tabs/:slug', requireAuth, async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM tabs WHERE owner_id = $1 AND slug = $2',
    [req.user.id, req.params.slug]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(tabRowToJson(rows[0]));
});

app.put('/api/tabs/:slug', requireAuth, async (req, res) => {
  const body = req.body || {};
  const { title, artist, visibility, ...rest } = body;
  const data = {
    tuning: rest.tuning,
    capo: rest.capo,
    tempo: rest.tempo,
    timeSignature: rest.timeSignature,
    subdivision: rest.subdivision,
    measures: rest.measures,
    notes: rest.notes,
  };
  const safeVisibility = VALID_VISIBILITY.has(visibility) ? visibility : null;

  const { rows } = await query(
    `UPDATE tabs
     SET title = COALESCE($3, title),
         artist = COALESCE($4, artist),
         data = $5,
         visibility = COALESCE($6, visibility),
         updated_at = NOW()
     WHERE owner_id = $1 AND slug = $2
     RETURNING *`,
    [
      req.user.id, req.params.slug,
      typeof title === 'string' ? title : null,
      typeof artist === 'string' ? artist : null,
      data,
      safeVisibility,
    ]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, updatedAt: rows[0].updated_at });
});

app.post('/api/tabs/:slug/rename', requireAuth, async (req, res) => {
  const newTitle = String(req.body?.title || '').trim();
  if (!newTitle) return res.status(400).json({ error: 'title required' });
  const newSlug = await uniqueSlug(req.user.id, slugify(newTitle), req.params.slug);
  const { rows } = await query(
    `UPDATE tabs SET title = $3, slug = $4, updated_at = NOW()
     WHERE owner_id = $1 AND slug = $2 RETURNING *`,
    [req.user.id, req.params.slug, newTitle, newSlug]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(tabRowToJson(rows[0]));
});

app.post('/api/tabs/:slug/visibility', requireAuth, async (req, res) => {
  const v = String(req.body?.visibility || '');
  if (!VALID_VISIBILITY.has(v)) return res.status(400).json({ error: 'invalid visibility' });
  const { rows } = await query(
    `UPDATE tabs SET visibility = $3, updated_at = NOW()
     WHERE owner_id = $1 AND slug = $2 RETURNING visibility`,
    [req.user.id, req.params.slug, v]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json({ visibility: rows[0].visibility });
});

app.delete('/api/tabs/:slug', requireAuth, async (req, res) => {
  await query(
    'DELETE FROM tabs WHERE owner_id = $1 AND slug = $2',
    [req.user.id, req.params.slug]
  );
  res.json({ ok: true });
});

// ---------- Public / browse ----------
app.get('/api/browse', async (_req, res) => {
  const { rows } = await query(
    `SELECT t.slug, t.title, t.artist, t.updated_at, u.username
     FROM tabs t JOIN users u ON u.id = t.owner_id
     WHERE t.visibility = 'public'
     ORDER BY t.updated_at DESC LIMIT 200`
  );
  res.json(rows.map((r) => ({
    slug: r.slug, title: r.title, artist: r.artist,
    username: r.username, updatedAt: r.updated_at,
  })));
});

app.get('/api/u/:username/:slug', async (req, res) => {
  const { rows } = await query(
    `SELECT t.*, u.username
     FROM tabs t JOIN users u ON u.id = t.owner_id
     WHERE u.username = $1 AND t.slug = $2`,
    [req.params.username, req.params.slug]
  );
  const r = rows[0];
  if (!r) return res.status(404).json({ error: 'not found' });
  const isOwner = req.user && req.user.id === r.owner_id;
  if (r.visibility === 'private' && !isOwner) {
    return res.status(404).json({ error: 'not found' });
  }
  res.json({
    ...tabRowToJson(r),
    username: r.username,
    isOwner,
  });
});

// ---------- 404 ----------
app.use((_req, res) => res.status(404).send('Not found'));

app.listen(PORT, () => {
  console.log(`Banjo Tab Editor on :${PORT}`);
});
