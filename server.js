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
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, email TEXT,
    role TEXT DEFAULT 'user', joined TEXT, banned INTEGER DEFAULT 0
  );
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
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { username: user.username, role: user.role } });
});

app.get('/api/admin/users', authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    const users = db.prepare('SELECT id, username, email, role, joined FROM users').all();
    res.json(users);
});

app.get('/api/stats', (req, res) => {
    const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    res.json({ users: count, battles: 0 });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));
