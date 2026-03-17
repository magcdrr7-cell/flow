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

// ─── 1. RAILWAY PROXY FIX ─────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ─── 2. DATABASE & SEEDING ────────────────────────────────────────────────────
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
  CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT );
`);

function seedIfEmpty() {
  const adminExists = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('Admin@FlowBars2026!', 10);
    db.prepare(`INSERT INTO users (username, password, role, joined) VALUES (?, ?, ?, ?)`).run(
      'admin', hash, 'admin', new Date().toISOString().slice(0, 10)
    );
    console.log('✅ Admin account created: admin / Admin@FlowBars2026!');
  }
}
seedIfEmpty();

// ─── 3. MIDDLEWARE (MUST BE ABOVE ROUTES) ─────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ 
    windowMs: 15 * 60 * 1000, 
    max: 1000, 
    validate: { trustProxy: false } 
});
app.use('/api', limiter);

// THIS FUNCTION MUST BE DEFINED BEFORE YOU USE IT IN ROUTES
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

function getClientIP(req) { 
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || req.ip || ''; 
}

// ─── 4. ROUTES ────────────────────────────────────────────────────────────────

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  delete user.password;
  res.json({ token, user });
});

// Admin: Get all users (This was causing the error, now it works!)
app.get('/api/admin/users', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  const users = db.prepare('SELECT id, username, email, role, joined, banned FROM users').all();
  res.json(users);
});

// Stats
app.get('/api/stats', (req, res) => {
  res.json({
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    battles: 0, // Placeholder
    rappers: 0  // Placeholder
  });
});

// ─── 5. SPA FALLBACK ──────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Server active on port ${PORT}`));
