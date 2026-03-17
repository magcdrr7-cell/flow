'use strict';
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
// Railway provides the PORT variable; we use 0.0.0.0 to ensure it's reachable
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'flowbars-2026-secret';

const db = new Database(path.join(__dirname, 'database.db'));

// Ensure all tables exist
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, email TEXT,
    role TEXT DEFAULT 'user', joined TEXT, banned INTEGER DEFAULT 0, avatar TEXT
  );
  CREATE TABLE IF NOT EXISTS battles (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, status TEXT);
  CREATE TABLE IF NOT EXISTS rappers (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE);
`);

// Reset/Seed Admin: admin | Admin@123
const hash = bcrypt.hashSync('Admin@123', 10);
db.prepare("INSERT OR REPLACE INTO users (id, username, password, role, joined) VALUES (1, 'admin', ?, 'admin', '2026-03-17')").run(hash);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- AUTH ROUTES ---
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
    res.json({ token, user: { username: user.username, role: user.role } });
});

app.post('/api/auth/register', (req, res) => {
    const { username, password } = req.body;
    try {
        const h = bcrypt.hashSync(password, 10);
        const info = db.prepare('INSERT INTO users (username, password, joined) VALUES (?,?,?)').run(username, h, '2026-03-17');
        const token = jwt.sign({ id: info.lastInsertRowid, username, role: 'user' }, JWT_SECRET);
        res.json({ token, user: { username, role: 'user' } });
    } catch (e) { res.status(400).json({ error: 'Username taken' }); }
});

// --- DESIGN & SETTINGS (Fixes "Destroyed" Look) ---
app.get('/api/settings', (req, res) => {
    res.json({ siteName: 'Flow & Bars', seasonText: 'Season 3', registrationOpen: true });
});

app.get('/api/design', (req, res) => {
    res.json({ 
        colors: { primary: '#FF2D55', accent: '#00D4FF', gold: '#FFD700', bg: '#070707', text: '#e8e8e8' }, 
        sections: { hero: true, battles: true, rappers: true, news: true } 
    });
});

// --- DATA ROUTES ---
app.get('/api/battles', (req, res) => res.json(db.prepare('SELECT * FROM battles').all()));
app.get('/api/rappers', (req, res) => res.json(db.prepare('SELECT * FROM rappers').all()));
app.get('/api/stats', (req, res) => res.json({ users: 1, battles: 0, live: 0 }));

// --- CATCH-ALLS ---
app.use('/api/*', (req, res) => res.status(404).json({ error: 'Not found' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server on ${PORT}`));
