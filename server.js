'use strict';
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'flowbars-2026-secret';

// ─── DATABASE ─────────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'database.db'));

// Initialize all tables needed by the frontend
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, email TEXT,
    role TEXT DEFAULT 'user', joined TEXT, banned INTEGER DEFAULT 0,
    bio TEXT, avatar TEXT
  );
  CREATE TABLE IF NOT EXISTS battles (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, status TEXT DEFAULT 'upcoming', rapper1 TEXT, rapper2 TEXT, rapper1_id INTEGER, rapper2_id INTEGER, votes1 INTEGER DEFAULT 0, votes2 INTEGER DEFAULT 0, featured INTEGER DEFAULT 0, views INTEGER DEFAULT 0, round TEXT, winner TEXT, date TEXT);
  CREATE TABLE IF NOT EXISTS rappers (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, real_name TEXT, city TEXT, style TEXT, bio TEXT, emoji TEXT, wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0, pts INTEGER DEFAULT 0, followers INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY AUTOINCREMENT, title_en TEXT, title_ka TEXT, excerpt_en TEXT, excerpt_ka TEXT, content TEXT, category TEXT, author TEXT, date TEXT, emoji TEXT);
  CREATE TABLE IF NOT EXISTS banners (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, emoji TEXT, color TEXT, active INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, role TEXT, avatar TEXT, text TEXT, time TEXT, is_ai INTEGER DEFAULT 0);
`);

// Seed Admin if not exists (User: admin | Pass: Admin@123)
const adminExists = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
if (!adminExists) {
    const hash = bcrypt.hashSync('Admin@123', 10);
    db.prepare('INSERT INTO users (username, password, role, joined) VALUES (?,?,?,?)')
      .run('admin', hash, 'admin', new Date().toISOString().slice(0, 10));
    console.log("✅ Admin user created: admin / Admin@123");
}

// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(decoded.id);
        if (!user || user.banned) return res.status(403).json({ error: 'Access denied' });
        req.user = user;
        next();
    } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

// Login
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { username: user.username, role: user.role, avatar: user.avatar } });
});

// Register
app.post('/api/auth/register', (req, res) => {
    const { username, password, email } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    try {
        const hash = bcrypt.hashSync(password, 10);
        const info = db.prepare('INSERT INTO users (username, password, email, joined) VALUES (?,?,?,?)')
          .run(username, hash, email || '', new Date().toISOString().slice(0, 10));
        
        const token = jwt.sign({ id: info.lastInsertRowid, username, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { username, role: 'user' } });
    } catch (err) {
        if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already taken' });
        res.status(500).json({ error: 'Server error during registration' });
    }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({ username: req.user.username, role: req.user.role, bio: req.user.bio, avatar: req.user.avatar });
});

// ─── CONTENT ROUTES ───────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
    const users = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const battles = db.prepare('SELECT COUNT(*) as c FROM battles').get().c;
    const rappers = db.prepare('SELECT COUNT(*) as c FROM rappers').get().c;
    const news = db.prepare('SELECT COUNT(*) as c FROM news').get().c;
    res.json({ users, battles, rappers, news, liveBattles: 0, totalVotes: 0 });
});

app.get('/api/settings', (req, res) => {
    res.json({ siteName: 'Flow & Bars', seasonText: 'Season 3', registrationOpen: true });
});

app.get('/api/design', (req, res) => {
    res.json({ colors: { primary: '#FF2D55', bg: '#070707' }, sections: { hero: true, battles: true, rappers: true } });
});

// Generic Fetchers
app.get('/api/battles', (req, res) => res.json(db.prepare('SELECT * FROM battles').all()));
app.get('/api/rappers', (req, res) => res.json(db.prepare('SELECT * FROM rappers').all()));
app.get('/api/news', (req, res) => res.json(db.prepare('SELECT * FROM news').all()));
app.get('/api/banners', (req, res) => res.json(db.prepare('SELECT * FROM banners').all()));

// ─── ERROR HANDLING ───────────────────────────────────────────────────────────

// Catch-all for API (prevents the HTML/JSON error)
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: `Route ${req.originalUrl} not found on this server` });
});

// Frontend
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
