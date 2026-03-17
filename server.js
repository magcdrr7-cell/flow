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

// Initialize tables so the frontend queries don't crash
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
  CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter TEXT, reported TEXT, reason TEXT, status TEXT DEFAULT 'pending', date TEXT);
`);

// Seed Admin if not exists
const admin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
if (!admin) {
    const hash = bcrypt.hashSync('Admin@123', 10);
    db.prepare('INSERT INTO users (username, password, role, joined) VALUES (?,?,?,?)')
      .run('admin', hash, 'admin', new Date().toISOString().slice(0, 10));
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

// ─── ROUTES ──────────────────────────────────────────────────────────────────

// Auth
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { username: user.username, role: user.role } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({ username: req.user.username, role: req.user.role, email: req.user.email, bio: req.user.bio, joined: req.user.joined, avatar: req.user.avatar });
});

// Admin & Stats
app.get('/api/admin/users', authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    const users = db.prepare('SELECT id, username, email, role, joined, banned FROM users').all();
    res.json(users);
});

app.get('/api/stats', (req, res) => {
    const usersCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const battlesCount = db.prepare('SELECT COUNT(*) as c FROM battles').get().c;
    res.json({ users: usersCount, battles: battlesCount, liveBattles: 0, totalVotes: 0, totalViews: 0, news: 0, pendingReports: 0, bannedUsers: 0 });
});

// App Settings & Design
app.get('/api/settings', (req, res) => {
    res.json({ maintenanceMode: false, registrationOpen: true, chatEnabled: true, siteName: 'Flow & Bars', seasonText: 'Season 3' });
});

app.get('/api/design', (req, res) => {
    res.json({ 
        colors: { primary: '#FF2D55', accent: '#00D4FF', gold: '#FFD700', bg: '#070707', text: '#e8e8e8' }, 
        sections: { hero: true, statBar: true, battles: true, rappers: true, news: true } 
    });
});

// Primary Entities
app.get('/api/battles', (req, res) => res.json(db.prepare('SELECT * FROM battles').all()));
app.get('/api/rappers', (req, res) => res.json(db.prepare('SELECT * FROM rappers').all()));
app.get('/api/news', (req, res) => res.json(db.prepare('SELECT * FROM news').all()));
app.get('/api/banners', (req, res) => res.json(db.prepare('SELECT * FROM banners').all()));
app.get('/api/chat', (req, res) => res.json(db.prepare('SELECT * FROM chat_messages').all()));
app.get('/api/reports', (req, res) => res.json(db.prepare('SELECT * FROM reports').all()));

// --- API CATCH-ALL ---
// Crucial fix: Returns a proper JSON error if an API route is missing, avoiding the HTML parsing error.
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// ─── FRONTEND FALLBACK ───────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));
