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

// ─── RAILWAY PROXY CONFIG ───────────────────────────────────────────────────
app.set('trust proxy', 1);

// ─── DATABASE ───────────────────────────────────────────────────────────────
// Note: If you have a Railway Volume mounted to /data, change this to:
// new Database('/data/database.db');
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
  CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT );
  CREATE TABLE IF NOT EXISTS design_config ( key TEXT PRIMARY KEY, value TEXT );
`);

// ─── SEEDING (FIXED) ────────────────────────────────────────────────────────
function seedIfEmpty() {
  const adminExists = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  const now = new Date().toISOString().slice(0, 10);
  const hash = (pw) => bcrypt.hashSync(pw, 10);

  if (!adminExists) {
    console.log('⚠️ Admin not found. Creating default admin...');
    db.prepare(`INSERT INTO users (username, password, email, role, bio, avatar, joined) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'admin', 
      hash('Admin@FlowBars2026!'), 
      'admin@flowbars.ge', 
      'admin', 
      'Platform Administrator', 
      '👑', 
      now
    );
    console.log('✅ Admin account created: admin / Admin@FlowBars2026!');
  }

  // Ensure settings exist
  const setSetting = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
  [['siteName','Flow & Bars'], ['seasonText','Season 3'], ['registrationOpen','true']].forEach(s => setSetting.run(...s));
}
seedIfEmpty();

// ─── MIDDLEWARE ─────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ 
    windowMs: 15 * 60 * 1000, 
    max: 1000, 
    validate: { trustProxy: false } 
});
app.use('/api', limiter);

function getClientIP(req) { 
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || req.ip || ''; 
}

// ─── AUTH ROUTES ────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Check Admin IP Lock
  if (user.role === 'admin') {
    const ip = getClientIP(req);
    if (ip !== ADMIN_IP && ip !== '::1' && ip !== '127.0.0.1') {
      return res.status(403).json({ error: `Unauthorized IP: ${ip}` });
    }
  }
  
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  delete user.password;
  res.json({ token, user });
});

// Registration Route (For your "Unexpected token" fix)
app.post('/api/auth/register', (req, res) => {
  const { username, password, email } = req.body;
  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const now = new Date().toISOString().slice(0, 10);
    const result = db.prepare(`INSERT INTO users (username, password, email, joined) VALUES (?, ?, ?, ?)`).run(username, hashedPassword, email, now);
    const token = jwt.sign({ id: result.lastInsertRowid, username, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: result.lastInsertRowid, username, role: 'user' } });
  } catch (err) {
    res.status(400).json({ error: 'User already exists' });
  }
});

// ─── CONTENT ROUTES ──────────────────────────────────────────────────────────
app.get('/api/battles', (req, res) => res.json(db.prepare('SELECT * FROM battles ORDER BY id DESC').all()));
app.get('/api/rappers', (req, res) => res.json(db.prepare('SELECT * FROM rappers ORDER BY pts DESC').all()));

app.get('/api/stats', (req, res) => {
  res.json({
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    battles: db.prepare('SELECT COUNT(*) as c FROM battles').get().c,
    rappers: db.prepare('SELECT COUNT(*) as c FROM rappers').get().c
  });
});

// ─── ADMIN: GET ALL USERS ─────────────────────────────────────────────────────
app.get('/api/admin/users', authMiddleware, (req, res) => {
  // Only admins can see the full user list
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

  try {
    // We select everything EXCEPT passwords for security
    const users = db.prepare(`
      SELECT id, username, email, role, joined, banned, avatar, wins, battles_count 
      FROM users 
      ORDER BY id DESC
    `).all();
    
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── SPA FALLBACK ───────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
