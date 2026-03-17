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
const JWT_SECRET = process.env.JWT_SECRET || 'flowbars';
const ADMIN_IP = process.env.ADMIN_IP || '176.74.94.221';

// ─── RAILWAY PROXY FIX ────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ─── DATABASE ─────────────────────────────────────────────────────────────────
// Tip: If you use a Railway Volume, use: new Database('/data/database.db');
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
  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title_en TEXT, title_ka TEXT,
    excerpt_en TEXT, excerpt_ka TEXT, content TEXT DEFAULT '',
    category TEXT, author TEXT, date TEXT, featured INTEGER DEFAULT 0, emoji TEXT DEFAULT '📰'
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT,
    role TEXT, avatar TEXT, text TEXT, time TEXT, is_ai INTEGER DEFAULT 0, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS votes ( user_id INTEGER, battle_id INTEGER, side TEXT, PRIMARY KEY (user_id, battle_id) );
  CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT );
  CREATE TABLE IF NOT EXISTS design_config ( key TEXT PRIMARY KEY, value TEXT );
`);

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ 
    windowMs: 15 * 60 * 1000, 
    max: 500, 
    standardHeaders: true, 
    legacyHeaders: false,
    validate: { trustProxy: false } 
});
app.use('/api', limiter);

function getClientIP(req) { 
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || req.ip || ''; 
}

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

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────

// NEW: Fixed Registration Route
app.post('/api/auth/register', (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  
  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const now = new Date().toISOString().slice(0, 10);
    const result = db.prepare(`INSERT INTO users (username, password, email, joined) VALUES (?, ?, ?, ?)`).run(username, hashedPassword, email, now);
    
    const token = jwt.sign({ id: result.lastInsertRowid, username, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: result.lastInsertRowid, username, role: 'user', avatar: '🎵' } });
  } catch (err) {
    res.status(400).json({ error: 'Username already exists' });
  }
});

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

// ─── CONTENT ROUTES ──────────────────────────────────────────────────────────
app.get('/api/rappers', (req, res) => res.json(db.prepare('SELECT * FROM rappers ORDER BY pts DESC').all()));
app.get('/api/battles', (req, res) => res.json(db.prepare('SELECT * FROM battles ORDER BY id DESC').all()));
app.get('/api/news', (req, res) => res.json(db.prepare('SELECT * FROM news ORDER BY id DESC').all()));

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

app.get('/api/chat', (req, res) => res.json(db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT 100').all().reverse()));
app.post('/api/chat', authMiddleware, (req, res) => {
  const { text } = req.body;
  const time = new Date().toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit' });
  db.prepare(`INSERT INTO chat_messages (user_id, username, role, avatar, text, time, created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(req.user.id, req.user.username, req.user.role, req.user.avatar, text, time, new Date().toISOString());
  res.json({ success: true });
});

app.get('/api/stats', (req, res) => {
  res.json({
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    battles: db.prepare('SELECT COUNT(*) as c FROM battles').get().c,
    rappers: db.prepare('SELECT COUNT(*) as c FROM rappers').get().c,
    chatMessages: db.prepare('SELECT COUNT(*) as c FROM chat_messages').get().c
  });
});

// ─── SPA FALLBACK ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`🚀 Flow & Bars Live on Port ${PORT}`);
});
