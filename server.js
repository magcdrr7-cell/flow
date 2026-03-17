'use strict';
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'flowbars-ultra-secret-key-change-me-in-production-2026';
const ADMIN_IP = process.env.ADMIN_IP || '176.74.94.221';

// ─── RAILWAY/PROXY CONFIG ───────────────────────────────────────────────────
// This fixes the ERR_ERL_PERMISSIVE_TRUST_PROXY error on Railway
app.set('trust proxy', 1); 

// ─── DATABASE ─────────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'database.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, email TEXT,
    role TEXT DEFAULT 'user', bio TEXT DEFAULT '', avatar TEXT DEFAULT '🎵',
    banned INTEGER DEFAULT 0, joined TEXT, battles_count INTEGER DEFAULT 0, wins INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS rappers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL, real_name TEXT, city TEXT, emoji TEXT DEFAULT '🎤',
    wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0, pts INTEGER DEFAULT 0,
    followers INTEGER DEFAULT 0, bio TEXT DEFAULT '', style TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, rapper1 TEXT, rapper2 TEXT, rapper1_id INTEGER, rapper2_id INTEGER,
    status TEXT DEFAULT 'upcoming', round TEXT, votes1 INTEGER DEFAULT 0, votes2 INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0, featured INTEGER DEFAULT 0, date TEXT, winner TEXT
  );
  CREATE TABLE IF NOT EXISTS battle_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, battle_id INTEGER, user_id INTEGER,
    username TEXT, role TEXT, avatar TEXT, text TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title_en TEXT, title_ka TEXT,
    excerpt_en TEXT, excerpt_ka TEXT, content TEXT DEFAULT '',
    category TEXT, author TEXT, date TEXT, featured INTEGER DEFAULT 0, emoji TEXT DEFAULT '📰'
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT,
    role TEXT, avatar TEXT, text TEXT, time TEXT, is_ai INTEGER DEFAULT 0, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reporter TEXT, reported TEXT,
    reason TEXT, status TEXT DEFAULT 'pending', date TEXT
  );
  CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, emoji TEXT, color TEXT, active INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT );
  CREATE TABLE IF NOT EXISTS design_config ( key TEXT PRIMARY KEY, value TEXT );
  CREATE TABLE IF NOT EXISTS votes ( user_id INTEGER, battle_id INTEGER, side TEXT, PRIMARY KEY (user_id, battle_id) );
  CREATE TABLE IF NOT EXISTS follows ( user_id INTEGER, rapper_id INTEGER, PRIMARY KEY (user_id, rapper_id) );
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT, judge_id INTEGER, battle_id INTEGER,
    technique1 INTEGER, delivery1 INTEGER, content1 INTEGER,
    technique2 INTEGER, delivery2 INTEGER, content2 INTEGER, created_at TEXT
  );
`);

// ─── INITIAL SEEDING ─────────────────────────────────────────────────────────
function seedIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount > 0) return;
  const hash = (pw) => bcrypt.hashSync(pw, 10);
  const now = new Date().toISOString().slice(0, 10);

  const insertUser = db.prepare(`INSERT INTO users (username,password,email,role,bio,avatar,joined) VALUES (?,?,?,?,?,?,?)`);
  insertUser.run('admin', hash('Admin@FlowBars2026!'), 'admin@flowbars.ge', 'admin', 'Platform Administrator', '👑', now);
  insertUser.run('mod1', hash('mod123'), 'mod@flowbars.ge', 'moderator', 'Community Moderator', '🛡️', now);
  insertUser.run('designer1', hash('des123'), 'design@flowbars.ge', 'designer', 'Creative Designer', '🎨', now);
  insertUser.run('judge1', hash('judge123'), 'judge@flowbars.ge', 'judge', 'Official Battle Judge', '⚖️', now);

  const setSetting = db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)`);
  [['siteName','Flow & Bars'], ['seasonText','Season 3'], ['maintenanceMode','false'], ['registrationOpen','true'], ['chatEnabled','true']].forEach(s => setSetting.run(...s));
  console.log('✅ Production database seeded.');
}
seedIfEmpty();

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Updated Limiter to stop validation errors on Railway
const limiter = rateLimit({ 
  windowMs: 15 * 60 * 1000, 
  max: 1000, 
  validate: { trustProxy: false } 
});
app.use('/api', limiter);

function getClientIP(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || req.ip || ''; }

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(decoded.id);
    if (!user || user.banned) return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

const checkRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
  next();
};

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  if (user.role === 'admin' && getClientIP(req) !== ADMIN_IP && getClientIP(req) !== '::1') return res.status(403).json({ error: 'Unauthorized IP' });
  
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  delete user.password;
  res.json({ token, user });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  delete req.user.password;
  res.json(req.user);
});

// ─── RAPPERS & BATTLES (FULL LOGIC) ───────────────────────────────────────────
app.get('/api/rappers', (req, res) => res.json(db.prepare('SELECT * FROM rappers ORDER BY pts DESC').all()));
app.get('/api/battles', (req, res) => res.json(db.prepare('SELECT * FROM battles ORDER BY id DESC').all()));

app.post('/api/rappers', authMiddleware, checkRole(['admin']), (req, res) => {
  const { username, real_name, city, emoji, bio, style } = req.body;
  const r = db.prepare(`INSERT INTO rappers (username,real_name,city,emoji,bio,style) VALUES (?,?,?,?,?,?)`).run(username, real_name, city, emoji, bio, style);
  res.json({ id: r.lastInsertRowid });
});

app.post('/api/battles/:id/vote', authMiddleware, (req, res) => {
  const { side } = req.body;
  const battle = db.prepare('SELECT status FROM battles WHERE id=?').get(req.params.id);
  if (!battle || battle.status !== 'live') return res.status(400).json({ error: 'Voting closed' });
  try {
    db.prepare('INSERT INTO votes (user_id, battle_id, side) VALUES (?,?,?)').run(req.user.id, req.params.id, side);
    db.prepare(`UPDATE battles SET ${side === 'a' ? 'votes1' : 'votes2'} = ${side === 'a' ? 'votes1' : 'votes2'} + 1 WHERE id=?`).run(req.params.id);
    res.json({ success: true });
  } catch { res.status(400).json({ error: 'Already voted' }); }
});

// ─── NEWS, CHAT, & REPORTING ──────────────────────────────────────────────────
app.get('/api/news', (req, res) => res.json(db.prepare('SELECT * FROM news ORDER BY id DESC').all()));
app.post('/api/chat', authMiddleware, (req, res) => {
  const { text } = req.body;
  const time = new Date().toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit' });
  db.prepare(`INSERT INTO chat_messages (user_id, username, role, avatar, text, time, created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(req.user.id, req.user.username, req.user.role, req.user.avatar, text, time, new Date().toISOString());
  res.json({ success: true });
});

// ─── ADMIN STATS & RESET ──────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  res.json({
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    battles: db.prepare('SELECT COUNT(*) as c FROM battles').get().c,
    rappers: db.prepare('SELECT COUNT(*) as c FROM rappers').get().c,
    pendingReports: db.prepare("SELECT COUNT(*) as c FROM reports WHERE status='pending'").get().c
  });
});

app.post('/api/admin/reset', authMiddleware, checkRole(['admin']), (req, res) => {
  if (getClientIP(req) !== ADMIN_IP && getClientIP(req) !== '::1') return res.status(403).json({ error: 'Access denied' });
  const tables = ['battles', 'rappers', 'news', 'chat_messages', 'reports', 'battle_comments', 'votes', 'follows', 'scores', 'banners'];
  tables.forEach(t => db.prepare(`DELETE FROM ${t}`).run());
  db.prepare('DELETE FROM users WHERE id > 1').run();
  res.json({ success: true, message: "System Wiped." });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`🚀 Flow & Bars Live on Port ${PORT}`);
  console.log(`🛡️ Admin IP Lock: ${ADMIN_IP}`);
});
