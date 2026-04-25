import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { query } from './db.js';

const SESSION_DAYS = 30;
const COOKIE_NAME = 'btab_session';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  if (test.length !== known.length) return false;
  return timingSafeEqual(known, test);
}

export function newToken() {
  return randomBytes(32).toString('hex');
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    if (k) out[k] = v;
  }
  return out;
}

export function setSessionCookie(res, token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  const parts = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export async function createSession(userId) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, userId, expiresAt]
  );
  return token;
}

export async function destroySession(token) {
  if (!token) return;
  await query('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function loadUserFromRequest(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const { rows } = await query(
    `SELECT u.id, u.email, u.username
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW()`,
    [token]
  );
  return rows[0] || null;
}

export async function attachUser(req, _res, next) {
  try {
    req.user = await loadUserFromRequest(req);
  } catch (e) {
    console.error('attachUser error', e);
    req.user = null;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'login required' });
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{1,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSignup({ email, username, password }) {
  if (!email || !EMAIL_RE.test(email)) return 'Invalid email';
  if (!username || !USERNAME_RE.test(username))
    return 'Username must be 2–31 chars, lowercase letters/numbers/_/- only, starting with a letter or digit';
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  return null;
}
