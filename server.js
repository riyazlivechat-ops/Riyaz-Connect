const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const { pool, migrate } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

const PROFILE_PATH = path.join(__dirname, 'config', 'profile.json');
const loadProfile = () => JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));

if (!ADMIN_PASSWORD) {
  console.warn('ADMIN_PASSWORD is not set: the dashboard is locked until you set it.');
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '32kb' }));

// ---------- helpers ----------

const STATUSES = ['new', 'contacted', 'meeting', 'client', 'archived'];
const TIMELINES = ['now', 'quarter', 'exploring'];
const CHANNELS = ['whatsapp', 'email', 'linkedin', 'call'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, max = 200) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

function pick(value, allowed) {
  return allowed.includes(value) ? value : null;
}

function normaliseLinkedIn(value) {
  const v = clean(value, 300);
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/linkedin\.com/i.test(v)) return `https://${v.replace(/^\/+/, '')}`;
  return `https://www.linkedin.com/in/${v.replace(/^@/, '')}`;
}

// Lead score: how soon they need help matters most, then how much they told us.
function scoreLead(c) {
  let score = { now: 45, quarter: 25, exploring: 8 }[c.timeline] || 0;
  score += Math.min(c.interests.length, 3) * 6;
  if (c.challenge) score += 15;
  if (c.email || c.phone) score += 8;
  if (c.linkedin) score += 4;
  if (c.referral) score += 5;
  score = Math.min(score, 100);
  const warmth = score >= 55 ? 'hot' : score >= 30 ? 'warm' : 'cold';
  return { score, warmth };
}

function parseContact(body, profile) {
  const interests = Array.isArray(body.interests)
    ? body.interests.map((i) => clean(i, 80)).filter(Boolean).slice(0, 10)
    : [];
  const email = clean(body.email, 200);
  const contact = {
    event: clean(body.event, 120) || profile.event.name,
    full_name: clean(body.full_name, 120),
    company: clean(body.company),
    role: clean(body.role),
    email: email ? email.toLowerCase() : null,
    phone: clean(body.phone, 40),
    linkedin: normaliseLinkedIn(body.linkedin),
    interests,
    challenge: clean(body.challenge, 1000),
    timeline: pick(body.timeline, TIMELINES),
    preferred_channel: pick(body.preferred_channel, CHANNELS),
    referral: clean(body.referral, 300),
    consent: body.consent === true,
  };
  const errors = [];
  if (!contact.full_name) errors.push('Please add your name.');
  if (contact.email && !EMAIL_RE.test(contact.email)) errors.push('That email address does not look right.');
  return { contact, errors };
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function isAuthed(req) {
  const token = readCookie(req, 'rc_session');
  if (!token) return false;
  const [issued, sig] = token.split('.');
  if (!issued || !sig) return false;
  const expected = sign(issued);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Date.now() - Number(issued) < SESSION_TTL_MS;
}

function requireAdmin(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Please sign in.' });
}

function publicUrl(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function vcardEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- public routes ----------

app.get('/api/profile', (req, res) => {
  const p = loadProfile();
  res.json({ ...p, connectUrl: publicUrl(req) });
});

// Placeholder values in config/profile.json start with "TODO" and are never shown to visitors.
const real = (v) => (v && !/^TODO/i.test(v) ? v : '');

app.get('/vcard', (req, res) => {
  const p = loadProfile();
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${vcardEscape(p.name)}`,
    `N:;${vcardEscape(p.name)};;;`,
    real(p.company) && `ORG:${vcardEscape(p.company)}`,
    real(p.headline) && `TITLE:${vcardEscape(p.headline)}`,
    real(p.email) && `EMAIL;TYPE=INTERNET:${p.email}`,
    real(p.phone) && `TEL;TYPE=CELL:${p.phone}`,
    real(p.website) && `URL:${p.website}`,
    real(p.linkedin) && `X-SOCIALPROFILE;TYPE=linkedin:${p.linkedin}`,
    `NOTE:${vcardEscape(`Met at ${p.event.name}. ${real(p.bio)}`.trim())}`,
    'END:VCARD',
  ].filter(Boolean);
  const file = `${p.name.replace(/[^a-z0-9]+/gi, '-')}.vcf`;
  res.set('Content-Type', 'text/vcard; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${file}"`);
  res.send(lines.join('\r\n'));
});

app.get('/qr.svg', asyncRoute(async (req, res) => {
  const svg = await QRCode.toString(publicUrl(req), {
    type: 'svg', margin: 1, errorCorrectionLevel: 'M',
    color: { dark: '#0b3d2e', light: '#ffffff' },
  });
  res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'no-cache').send(svg);
}));

const connectLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

app.post('/api/connect', connectLimiter, asyncRoute(async (req, res) => {
  // Honeypot: real people never see or fill this field.
  if (req.body.website_url) return res.status(201).json({ ok: true });

  const profile = loadProfile();
  const { contact, errors } = parseContact(req.body, profile);
  if (!contact.email && !contact.phone && !contact.linkedin) {
    errors.push('Please share at least one way to reach you: email, phone or LinkedIn.');
  }
  if (!contact.consent) errors.push('Please tick the box so I can follow up with you.');
  if (errors.length) return res.status(400).json({ errors });

  const { score, warmth } = scoreLead(contact);
  const values = [
    contact.event, contact.full_name, contact.company, contact.role, contact.email, contact.phone,
    contact.linkedin, contact.interests, contact.challenge, contact.timeline, contact.preferred_channel,
    contact.referral, contact.consent, score, warmth, clean(req.get('user-agent'), 300),
  ];
  const columns = 'event, full_name, company, role, email, phone, linkedin, interests, challenge, timeline, '
    + 'preferred_channel, referral, consent, score, warmth, user_agent';
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

  // If the same person submits twice (e.g. an offline retry), refresh their record instead of duplicating it.
  const sql = contact.email
    ? `INSERT INTO contacts (${columns}) VALUES (${placeholders})
       ON CONFLICT (event, lower(email)) WHERE email IS NOT NULL DO UPDATE SET
         full_name = EXCLUDED.full_name,
         company = COALESCE(EXCLUDED.company, contacts.company),
         role = COALESCE(EXCLUDED.role, contacts.role),
         phone = COALESCE(EXCLUDED.phone, contacts.phone),
         linkedin = COALESCE(EXCLUDED.linkedin, contacts.linkedin),
         interests = CASE WHEN cardinality(EXCLUDED.interests) > 0 THEN EXCLUDED.interests ELSE contacts.interests END,
         challenge = COALESCE(EXCLUDED.challenge, contacts.challenge),
         timeline = COALESCE(EXCLUDED.timeline, contacts.timeline),
         preferred_channel = COALESCE(EXCLUDED.preferred_channel, contacts.preferred_channel),
         referral = COALESCE(EXCLUDED.referral, contacts.referral),
         consent = EXCLUDED.consent,
         score = GREATEST(EXCLUDED.score, contacts.score),
         warmth = CASE WHEN EXCLUDED.score >= contacts.score THEN EXCLUDED.warmth ELSE contacts.warmth END,
         updated_at = now()
       RETURNING id`
    : `INSERT INTO contacts (${columns}) VALUES (${placeholders}) RETURNING id`;

  const { rows } = await pool.query(sql, values);
  res.status(201).json({ ok: true, id: rows[0].id, firstName: contact.full_name.split(/\s+/)[0] });
}));

// ---------- admin auth ----------

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const given = Buffer.from(String(req.body.password || ''));
  const expected = Buffer.from(ADMIN_PASSWORD);
  const ok = ADMIN_PASSWORD && given.length === expected.length && crypto.timingSafeEqual(given, expected);
  if (!ok) return res.status(401).json({ error: 'Wrong password.' });
  const issued = String(Date.now());
  const cookie = [
    `rc_session=${issued}.${sign(issued)}`,
    'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${SESSION_TTL_MS / 1000}`,
    IS_PROD && 'Secure',
  ].filter(Boolean).join('; ');
  res.set('Set-Cookie', cookie).json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.set('Set-Cookie', 'rc_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0').json({ ok: true });
});

app.get('/api/admin/me', (req, res) => res.json({ authed: isAuthed(req) }));

// ---------- admin data ----------

app.get('/api/contacts', requireAdmin, asyncRoute(async (req, res) => {
  const where = [];
  const params = [];
  const q = clean(req.query.q, 100);
  if (q) {
    params.push(`%${q}%`);
    where.push(`(full_name ILIKE $${params.length} OR company ILIKE $${params.length} OR email ILIKE $${params.length}
      OR notes ILIKE $${params.length} OR challenge ILIKE $${params.length} OR array_to_string(interests, ' ') ILIKE $${params.length})`);
  }
  const status = pick(req.query.status, STATUSES);
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  else where.push(`status <> 'archived'`);
  const warmth = pick(req.query.warmth, ['hot', 'warm', 'cold']);
  if (warmth) { params.push(warmth); where.push(`warmth = $${params.length}`); }
  if (req.query.due === '1') where.push(`follow_up_on <= CURRENT_DATE AND status IN ('new', 'contacted', 'meeting')`);

  const { rows } = await pool.query(
    `SELECT * FROM contacts ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE warmth WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END, created_at DESC LIMIT 500`,
    params,
  );
  res.json(rows);
}));

app.get('/api/stats', requireAdmin, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      count(*) FILTER (WHERE status <> 'archived')                                       AS total,
      count(*) FILTER (WHERE warmth = 'hot' AND status <> 'archived')                    AS hot,
      count(*) FILTER (WHERE created_at::date = CURRENT_DATE)                            AS today,
      count(*) FILTER (WHERE follow_up_on <= CURRENT_DATE AND status IN ('new','contacted','meeting')) AS due,
      count(*) FILTER (WHERE status = 'client')                                          AS clients
    FROM contacts`);
  res.json(rows[0]);
}));

app.post('/api/contacts', requireAdmin, asyncRoute(async (req, res) => {
  const profile = loadProfile();
  const { contact, errors } = parseContact(req.body, profile);
  if (errors.length) return res.status(400).json({ errors });
  const { score, warmth } = scoreLead(contact);
  const notes = clean(req.body.notes, 4000);
  const { rows } = await pool.query(
    `INSERT INTO contacts (event, source, full_name, company, role, email, phone, linkedin, interests, challenge,
       timeline, preferred_channel, referral, consent, score, warmth, notes, follow_up_on)
     VALUES ($1,'manual',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, CURRENT_DATE + 1)
     ON CONFLICT (event, lower(email)) WHERE email IS NOT NULL
       DO UPDATE SET notes = concat_ws(E'\\n', contacts.notes, EXCLUDED.notes), updated_at = now()
     RETURNING *`,
    [contact.event, contact.full_name, contact.company, contact.role, contact.email, contact.phone, contact.linkedin,
      contact.interests, contact.challenge, contact.timeline, contact.preferred_channel, contact.referral,
      contact.consent, score, warmth, notes],
  );
  res.status(201).json(rows[0]);
}));

app.patch('/api/contacts/:id', requireAdmin, asyncRoute(async (req, res) => {
  const sets = [];
  const params = [];
  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if ('notes' in req.body) add('notes', clean(req.body.notes, 4000));
  if ('status' in req.body) {
    const s = pick(req.body.status, STATUSES);
    if (!s) return res.status(400).json({ error: 'Unknown status.' });
    add('status', s);
  }
  if ('warmth' in req.body) {
    const w = pick(req.body.warmth, ['hot', 'warm', 'cold']);
    if (!w) return res.status(400).json({ error: 'Unknown warmth.' });
    add('warmth', w);
  }
  if ('follow_up_on' in req.body) {
    const d = req.body.follow_up_on;
    if (d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'Bad date.' });
    add('follow_up_on', d);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE contacts SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
    params,
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found.' });
  res.json(rows[0]);
}));

app.delete('/api/contacts/:id', requireAdmin, asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM contacts WHERE id = $1', [req.params.id]);
  res.status(rowCount ? 204 : 404).end();
}));

app.get('/api/contacts.csv', requireAdmin, asyncRoute(async (req, res) => {
  const cols = ['created_at', 'event', 'full_name', 'company', 'role', 'email', 'phone', 'linkedin', 'interests',
    'challenge', 'timeline', 'preferred_channel', 'referral', 'warmth', 'score', 'status', 'follow_up_on', 'notes', 'source'];
  const { rows } = await pool.query(`SELECT ${cols.join(', ')} FROM contacts ORDER BY created_at`);
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    let s = Array.isArray(v) ? v.join('; ') : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^\+[\d\s()-]+$/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="riyaz-connect-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`\uFEFF${csv}`);
}));

// ---------- static & errors ----------

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/healthz', asyncRoute(async (req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((err, req, res, _next) => {
  if (err.code === '22P02') return res.status(404).json({ error: 'Not found.' }); // invalid uuid
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

migrate()
  .then(() => app.listen(PORT, () => console.log(`Riyaz Connect running on http://localhost:${PORT}`)))
  .catch((err) => { console.error('Could not prepare the database:', err.message); process.exit(1); });
