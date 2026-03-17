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

// ─── DATABASE ─────────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'database.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT,
    role TEXT DEFAULT 'user',
    bio TEXT DEFAULT '',
    avatar TEXT DEFAULT '🎵',
    banned INTEGER DEFAULT 0,
    joined TEXT,
    battles_count INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS rappers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    real_name TEXT,
    city TEXT,
    emoji TEXT DEFAULT '🎤',
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    pts INTEGER DEFAULT 0,
    followers INTEGER DEFAULT 0,
    bio TEXT DEFAULT '',
    style TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    rapper1 TEXT, rapper2 TEXT,
    rapper1_id INTEGER, rapper2_id INTEGER,
    status TEXT DEFAULT 'upcoming',
    round TEXT,
    votes1 INTEGER DEFAULT 0, votes2 INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    featured INTEGER DEFAULT 0,
    date TEXT, winner TEXT
  );
  CREATE TABLE IF NOT EXISTS battle_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    battle_id INTEGER, user_id INTEGER,
    username TEXT, role TEXT, avatar TEXT,
    text TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_en TEXT, title_ka TEXT,
    excerpt_en TEXT, excerpt_ka TEXT,
    content TEXT DEFAULT '',
    category TEXT, author TEXT,
    date TEXT, featured INTEGER DEFAULT 0,
    emoji TEXT DEFAULT '📰'
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, username TEXT,
    role TEXT, avatar TEXT,
    text TEXT, time TEXT,
    is_ai INTEGER DEFAULT 0, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter TEXT, reported TEXT,
    reason TEXT, status TEXT DEFAULT 'pending', date TEXT
  );
  CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT, emoji TEXT,
    color TEXT, active INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT
  );
  CREATE TABLE IF NOT EXISTS design_config (
    key TEXT PRIMARY KEY, value TEXT
  );
  CREATE TABLE IF NOT EXISTS votes (
    user_id INTEGER, battle_id INTEGER, side TEXT,
    PRIMARY KEY (user_id, battle_id)
  );
  CREATE TABLE IF NOT EXISTS follows (
    user_id INTEGER, rapper_id INTEGER,
    PRIMARY KEY (user_id, rapper_id)
  );
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    judge_id INTEGER, battle_id INTEGER,
    technique1 INTEGER, delivery1 INTEGER, content1 INTEGER,
    technique2 INTEGER, delivery2 INTEGER, content2 INTEGER,
    created_at TEXT
  );
`);

// ─── SEED DATA ────────────────────────────────────────────────────────────────
function seedIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount > 0) return;

  const hash = (pw) => bcrypt.hashSync(pw, 10);
  const now = new Date().toISOString().slice(0, 10);

  const insertUser = db.prepare(`INSERT INTO users (username,password,email,role,bio,avatar,joined) VALUES (?,?,?,?,?,?,?)`);
  [
    ['admin',    hash('Admin@FlowBars2026!'), 'admin@flowbars.ge',   'admin',     'Platform Administrator', '👑', now],
    ['mod1',     hash('mod123'),              'mod@flowbars.ge',     'moderator', 'Community Moderator',    '🛡️', now],
    ['designer1',hash('des123'),              'design@flowbars.ge',  'designer',  'Creative Designer',      '🎨', now],
    ['judge1',   hash('judge123'),            'judge@flowbars.ge',   'judge',     'Official Battle Judge',  '⚖️', now],
    ['IceKing',  hash('bat123'),              'iceking@ge.com',      'battler',   'Tbilisi flow king.',     '❄️', now],
    ['GhostFlow',hash('ghost123'),            'ghost@ge.com',        'battler',   'Ghost in the booth.',    '👻', now],
    ['TbilisiBars',hash('tb123'),             'tbars@ge.com',        'battler',   'Representing 995.',      '🏙️', now],
    ['user1',    hash('user123'),             'user1@ge.com',        'user',      'Hip-hop fan.',           '🎵', now],
  ].forEach(u => insertUser.run(...u));

  const insertRapper = db.prepare(`INSERT INTO rappers (username,real_name,city,emoji,wins,losses,pts,followers,bio,style) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  [
    ['IceKing',    'Giorgi Beridze',    'Tbilisi', '❄️', 9,3,2400,1240,'Tbilisi flow king since 2019.','Trap / Lyrical'],
    ['GhostFlow',  'Niko Tsiklauri',   'Kutaisi', '👻', 7,3,1980,890, 'Ghost in the booth.','Old-School / Freestyle'],
    ['TbilisiBars','Davit Kvaratskhelia','Tbilisi','🏙️',5,3,1560,720,'Bars from the capital.','Conscious / Drill'],
    ['MtnCrest',   'Sandro Lomidze',   'Batumi',  '🏔️',4,4,1200,540,'Black Sea flow.','Melodic / Trap'],
    ['NightRider', 'Lasha Jgenti',     'Gori',    '🌙', 3,5,980, 410,'Night sessions only.','Dark Trap'],
    ['VoiceTbilisi','Irakli Mgeladze', 'Rustavi', '📢', 6,2,1780,650,'Voice of the streets.','Lyrical / Freestyle'],
  ].forEach(r => insertRapper.run(...r));

  const insertBattle = db.prepare(`INSERT INTO battles (title,rapper1,rapper2,rapper1_id,rapper2_id,status,round,votes1,votes2,views,featured,date,winner) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  [
    ['IceKing vs GhostFlow',      'IceKing','GhostFlow',      1,2,'live',    'Grand Final',  324,198,4820,1,'2026-03-17',null],
    ['TbilisiBars vs VoiceTbilisi','TbilisiBars','VoiceTbilisi',3,6,'upcoming','Semi-Final', 0,  0,  1200,0,'2026-03-20',null],
    ['GhostFlow vs MtnCrest',     'GhostFlow','MtnCrest',     2,4,'finished','Quarter-Final',512,287,8900,0,'2026-03-10','GhostFlow'],
    ['IceKing vs NightRider',     'IceKing','NightRider',     1,5,'finished','Quarter-Final',680,190,12300,0,'2026-03-08','IceKing'],
    ['TbilisiBars vs MtnCrest',   'TbilisiBars','MtnCrest',   3,4,'finished','Round of 8',  340,360,6700,0,'2026-03-05','MtnCrest'],
    ['VoiceTbilisi vs NightRider','VoiceTbilisi','NightRider',6,5,'finished','Round of 8',  490,220,5500,0,'2026-03-03','VoiceTbilisi'],
  ].forEach(b => insertBattle.run(...b));

  const insertNews = db.prepare(`INSERT INTO news (title_en,title_ka,excerpt_en,excerpt_ka,category,author,date,featured,emoji) VALUES (?,?,?,?,?,?,?,?,?)`);
  [
    ['IceKing Dominates Grand Final','IceKing გრანდ ფინალში','The reigning champion delivers another flawless performance.','მოქმედი ჩემპიონი კვლავ ულმობელია.','Battle News','admin','2026-03-17',1,'🏆'],
    ['GhostFlow Announces Comeback','GhostFlow ბრუნდება','The Kutaisi legend has recovered and is training hard.','კუტაისის ლეგენდა გამოჯანმრთელდა.','Rapper News','mod1','2026-03-15',0,'👻'],
    ['Season 3 Prize Pool — 10,000 GEL','სეზონი 3-ის პრიზი','Biggest prize pool in Georgian rap battle history.','ყველაზე დიდი პრიზი ქართულ ბეთლში.','Platform News','admin','2026-03-12',0,'💰'],
    ['New Season Rules: What Changed?','ახალი სეზონის წესები','Platform introduces scoring reforms and new time limits.','პლატფორმა შეაქვს ქულების რეფორმა.','Platform News','judge1','2026-03-10',0,'📋'],
  ].forEach(n => insertNews.run(...n));

  const insertChat = db.prepare(`INSERT INTO chat_messages (user_id,username,role,avatar,text,time,is_ai,created_at) VALUES (?,?,?,?,?,?,?,?)`);
  [
    [5,'IceKing','battler','❄️','Ready for tonight! 🎤🔥','20:41',0,now],
    [8,'user1','user','🎵','IceKing is gonna destroy this! 🏆','20:42',0,now],
    [6,'GhostFlow','battler','👻',"Don't sleep on me. Bars incoming ⚡",'20:43',0,now],
    [0,'FlowBot','user','🤖','Welcome to Flow & Bars! ბეთლი იწყება! 🎤','20:44',1,now],
    [7,'TbilisiBars','battler','🏙️','995 represent! 🌆','20:45',0,now],
  ].forEach(c => insertChat.run(...c));

  const insertReport = db.prepare(`INSERT INTO reports (reporter,reported,reason,status,date) VALUES (?,?,?,?,?)`);
  [
    ['user1','TbilisiBars','Offensive language','pending','2026-03-16'],
    ['GhostFlow','NightRider','Harassment in comments','pending','2026-03-15'],
    ['mod1','user1','Spam messages','resolved','2026-03-14'],
  ].forEach(r => insertReport.run(...r));

  const insertBanner = db.prepare(`INSERT INTO banners (title,emoji,color,active) VALUES (?,?,?,?)`);
  [
    ['Season 3 Grand Final','🏆','linear-gradient(135deg,#1a0505,#0a0a1a)',1],
    ['Flow & Bars Live Events','🎤','linear-gradient(135deg,#051a05,#0a0a1a)',0],
  ].forEach(b => insertBanner.run(...b));

  const setSetting = db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)`);
  [
    ['siteName','Flow & Bars'],
    ['seasonText','Season 3 — Grand Final Week'],
    ['maintenanceMode','false'],
    ['registrationOpen','true'],
    ['chatEnabled','true'],
  ].forEach(s => setSetting.run(...s));

  // Default design config
  const setDesign = db.prepare(`INSERT OR REPLACE INTO design_config (key,value) VALUES (?,?)`);
  setDesign.run('config', JSON.stringify({
    colors: { primary:'#FF2D55', accent:'#00D4FF', gold:'#FFD700', bg:'#070707', text:'#e8e8e8' },
    heroTitle1: 'FLOW', heroTitle2: '& BARS',
    heroSubtitle: "Georgia's #1 rap battle platform. Watch live battles, vote for your favorite, and be part of the culture.",
    footerText: "Georgia's #1 Rap Platform",
    sections: { hero:true, statBar:true, battles:true, rappers:true, news:true },
    cardStyle: 'rounded',
    customCSS: ''
  }));

  console.log('✅ Database seeded with initial data');
}

seedIfEmpty();

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.set('trust proxy', true);
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false });
app.use('/api', limiter);

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many login attempts' } });

function getClientIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || req.ip || '';
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!user || user.banned) return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

function adminOrMod(req, res, next) {
  if (!req.user || !['admin','moderator'].includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  next();
}

function adminOrDesigner(req, res, next) {
  if (!req.user || !['admin','designer'].includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  next();
}

function adminOrJudge(req, res, next) {
  if (!req.user || !['admin','judge'].includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  next();
}

function checkAdminIP(req, res, next) {
  const ip = getClientIP(req);
  if (ip !== ADMIN_IP && ip !== '::1' && ip !== '127.0.0.1') {
    console.warn(`[SECURITY] Admin access attempt from unauthorized IP: ${ip}`);
    return res.status(403).json({ error: 'Access denied: unauthorized IP address' });
  }
  next();
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (user.banned) return res.status(403).json({ error: 'Account is banned' });

  if (user.role === 'admin') {
    const ip = getClientIP(req);
    if (ip !== ADMIN_IP && ip !== '::1' && ip !== '127.0.0.1') {
      console.warn(`[SECURITY] Admin login attempt from IP: ${ip}`);
      return res.status(403).json({ error: 'Admin access denied: unauthorized IP address' });
    }
  }

  if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

app.post('/api/auth/register', loginLimiter, (req, res) => {
  const settings = db.prepare('SELECT value FROM settings WHERE key=?').get('registrationOpen');
  if (settings?.value === 'false') return res.status(403).json({ error: 'Registration is closed' });

  const { username, email, password } = req.body;
  if (!username || !password || !email) return res.status(400).json({ error: 'All fields required' });
  if (username.length < 3) return res.status(400).json({ error: 'Username too short' });
  if (password.length < 6) return res.status(400).json({ error: 'Password too short' });

  const exists = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (exists) return res.status(409).json({ error: 'Username already taken' });

  const hash = bcrypt.hashSync(password, 10);
  const joined = new Date().toISOString().slice(0, 10);
  const result = db.prepare(`INSERT INTO users (username,password,email,role,bio,avatar,joined) VALUES (?,?,?,'user','','🎵',?)`).run(username, hash, email, joined);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const { password: _, ...safeUser } = req.user;
  res.json(safeUser);
});

// ─── USERS ────────────────────────────────────────────────────────────────────
app.get('/api/users', authMiddleware, adminOnly, (req, res) => {
  const users = db.prepare('SELECT id,username,email,role,bio,avatar,banned,joined,battles_count,wins FROM users').all();
  res.json(users);
});

app.put('/api/users/:id', authMiddleware, adminOnly, (req, res) => {
  const { role, banned, bio, email } = req.body;
  const { id } = req.params;
  if (Number(id) === 1 && role && role !== 'admin') return res.status(403).json({ error: 'Cannot change super admin role' });
  db.prepare('UPDATE users SET role=COALESCE(?,role), banned=COALESCE(?,banned), bio=COALESCE(?,bio), email=COALESCE(?,email) WHERE id=?')
    .run(role ?? null, banned !== undefined ? (banned ? 1 : 0) : null, bio ?? null, email ?? null, id);
  res.json({ success: true });
});

app.delete('/api/users/:id', authMiddleware, adminOnly, (req, res) => {
  if (req.params.id === '1') return res.status(403).json({ error: 'Cannot delete super admin' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

app.put('/api/users/me/profile', authMiddleware, (req, res) => {
  const { bio, email } = req.body;
  db.prepare('UPDATE users SET bio=COALESCE(?,bio), email=COALESCE(?,email) WHERE id=?').run(bio ?? null, email ?? null, req.user.id);
  res.json({ success: true });
});

// ─── RAPPERS ──────────────────────────────────────────────────────────────────
app.get('/api/rappers', (req, res) => {
  res.json(db.prepare('SELECT * FROM rappers ORDER BY pts DESC').all());
});

app.get('/api/rappers/:id', (req, res) => {
  const rapper = db.prepare('SELECT * FROM rappers WHERE id=?').get(req.params.id);
  if (!rapper) return res.status(404).json({ error: 'Not found' });
  res.json(rapper);
});

app.post('/api/rappers', authMiddleware, adminOnly, (req, res) => {
  const { username, real_name, city, emoji, bio, style } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  const r = db.prepare(`INSERT INTO rappers (username,real_name,city,emoji,bio,style) VALUES (?,?,?,?,?,?)`).run(username, real_name||'', city||'', emoji||'🎤', bio||'', style||'');
  res.json(db.prepare('SELECT * FROM rappers WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/rappers/:id', authMiddleware, adminOnly, (req, res) => {
  const { username, real_name, city, emoji, wins, losses, pts, bio, style } = req.body;
  db.prepare('UPDATE rappers SET username=COALESCE(?,username), real_name=COALESCE(?,real_name), city=COALESCE(?,city), emoji=COALESCE(?,emoji), wins=COALESCE(?,wins), losses=COALESCE(?,losses), pts=COALESCE(?,pts), bio=COALESCE(?,bio), style=COALESCE(?,style) WHERE id=?')
    .run(username??null, real_name??null, city??null, emoji??null, wins??null, losses??null, pts??null, bio??null, style??null, req.params.id);
  res.json({ success: true });
});

app.delete('/api/rappers/:id', authMiddleware, adminOnly, (req, res) => {
  db.prepare('DELETE FROM rappers WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Follow/unfollow
app.post('/api/rappers/:id/follow', authMiddleware, (req, res) => {
  const rapperId = Number(req.params.id);
  const userId = req.user.id;
  const exists = db.prepare('SELECT 1 FROM follows WHERE user_id=? AND rapper_id=?').get(userId, rapperId);
  if (exists) {
    db.prepare('DELETE FROM follows WHERE user_id=? AND rapper_id=?').run(userId, rapperId);
    db.prepare('UPDATE rappers SET followers=MAX(0,followers-1) WHERE id=?').run(rapperId);
    res.json({ following: false });
  } else {
    db.prepare('INSERT INTO follows (user_id,rapper_id) VALUES (?,?)').run(userId, rapperId);
    db.prepare('UPDATE rappers SET followers=followers+1 WHERE id=?').run(rapperId);
    res.json({ following: true });
  }
});

app.get('/api/rappers/:id/following', authMiddleware, (req, res) => {
  const exists = db.prepare('SELECT 1 FROM follows WHERE user_id=? AND rapper_id=?').get(req.user.id, req.params.id);
  res.json({ following: !!exists });
});

app.get('/api/follows', authMiddleware, (req, res) => {
  const ids = db.prepare('SELECT rapper_id FROM follows WHERE user_id=?').all(req.user.id).map(r => r.rapper_id);
  res.json(ids);
});

// ─── BATTLES ──────────────────────────────────────────────────────────────────
app.get('/api/battles', (req, res) => {
  const battles = db.prepare('SELECT * FROM battles ORDER BY id DESC').all();
  res.json(battles.map(b => ({ ...b, featured: !!b.featured })));
});

app.get('/api/battles/:id', (req, res) => {
  const battle = db.prepare('SELECT * FROM battles WHERE id=?').get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Not found' });
  const comments = db.prepare('SELECT * FROM battle_comments WHERE battle_id=? ORDER BY id ASC').all(req.params.id);
  res.json({ ...battle, featured: !!battle.featured, comments });
});

app.post('/api/battles', authMiddleware, adminOnly, (req, res) => {
  const { title, rapper1, rapper2, rapper1_id, rapper2_id, status, round } = req.body;
  if (!title || !rapper1 || !rapper2) return res.status(400).json({ error: 'title, rapper1, rapper2 required' });
  const date = new Date().toISOString().slice(0, 10);
  const r = db.prepare(`INSERT INTO battles (title,rapper1,rapper2,rapper1_id,rapper2_id,status,round,date) VALUES (?,?,?,?,?,?,?,?)`).run(title, rapper1, rapper2, rapper1_id||0, rapper2_id||0, status||'upcoming', round||'Round 1', date);
  res.json(db.prepare('SELECT * FROM battles WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/battles/:id', authMiddleware, adminOnly, (req, res) => {
  const { title, status, round, winner, featured, rapper1, rapper2, rapper1_id, rapper2_id } = req.body;
  db.prepare('UPDATE battles SET title=COALESCE(?,title), status=COALESCE(?,status), round=COALESCE(?,round), winner=COALESCE(?,winner), featured=COALESCE(?,featured), rapper1=COALESCE(?,rapper1), rapper2=COALESCE(?,rapper2), rapper1_id=COALESCE(?,rapper1_id), rapper2_id=COALESCE(?,rapper2_id) WHERE id=?')
    .run(title??null, status??null, round??null, winner??null, featured!==undefined?(featured?1:0):null, rapper1??null, rapper2??null, rapper1_id??null, rapper2_id??null, req.params.id);
  res.json({ success: true });
});

app.delete('/api/battles/:id', authMiddleware, adminOnly, (req, res) => {
  db.prepare('DELETE FROM battles WHERE id=?').run(req.params.id);
  db.prepare('DELETE FROM battle_comments WHERE battle_id=?').run(req.params.id);
  res.json({ success: true });
});

// Vote
app.post('/api/battles/:id/vote', authMiddleware, (req, res) => {
  const { side } = req.body;
  if (!['a','b'].includes(side)) return res.status(400).json({ error: 'side must be a or b' });
  const battle = db.prepare('SELECT * FROM battles WHERE id=?').get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  if (battle.status !== 'live') return res.status(400).json({ error: 'Battle is not live' });
  const exists = db.prepare('SELECT 1 FROM votes WHERE user_id=? AND battle_id=?').get(req.user.id, req.params.id);
  if (exists) return res.status(409).json({ error: 'Already voted' });
  db.prepare('INSERT INTO votes (user_id,battle_id,side) VALUES (?,?,?)').run(req.user.id, req.params.id, side);
  db.prepare(`UPDATE battles SET ${side==='a'?'votes1':'votes2'}=${side==='a'?'votes1':'votes2'}+1 WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

app.get('/api/battles/:id/myvote', authMiddleware, (req, res) => {
  const v = db.prepare('SELECT side FROM votes WHERE user_id=? AND battle_id=?').get(req.user.id, req.params.id);
  res.json({ side: v?.side || null });
});

// Comments
app.post('/api/battles/:id/comments', authMiddleware, (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Empty comment' });
  const time = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  const now = new Date().toISOString();
  const r = db.prepare(`INSERT INTO battle_comments (battle_id,user_id,username,role,avatar,text,created_at) VALUES (?,?,?,?,?,?,?)`).run(req.params.id, req.user.id, req.user.username, req.user.role, req.user.avatar, text.trim(), now);
  res.json(db.prepare('SELECT * FROM battle_comments WHERE id=?').get(r.lastInsertRowid));
});

app.delete('/api/battles/:bid/comments/:cid', authMiddleware, adminOrMod, (req, res) => {
  db.prepare('DELETE FROM battle_comments WHERE id=? AND battle_id=?').run(req.params.cid, req.params.bid);
  res.json({ success: true });
});

// ─── NEWS ─────────────────────────────────────────────────────────────────────
app.get('/api/news', (req, res) => {
  res.json(db.prepare('SELECT * FROM news ORDER BY id DESC').all());
});

app.get('/api/news/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM news WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json(a);
});

app.post('/api/news', authMiddleware, adminOrMod, (req, res) => {
  const { title_en, title_ka, excerpt_en, excerpt_ka, content, category, emoji, featured } = req.body;
  if (!title_en) return res.status(400).json({ error: 'title_en required' });
  const date = new Date().toISOString().slice(0, 10);
  const r = db.prepare(`INSERT INTO news (title_en,title_ka,excerpt_en,excerpt_ka,content,category,author,date,featured,emoji) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(title_en, title_ka||'', excerpt_en||'', excerpt_ka||'', content||'', category||'News', req.user.username, date, featured?1:0, emoji||'📰');
  res.json(db.prepare('SELECT * FROM news WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/news/:id', authMiddleware, adminOrMod, (req, res) => {
  const { title_en, title_ka, excerpt_en, excerpt_ka, content, category, featured, emoji } = req.body;
  db.prepare('UPDATE news SET title_en=COALESCE(?,title_en), title_ka=COALESCE(?,title_ka), excerpt_en=COALESCE(?,excerpt_en), excerpt_ka=COALESCE(?,excerpt_ka), content=COALESCE(?,content), category=COALESCE(?,category), featured=COALESCE(?,featured), emoji=COALESCE(?,emoji) WHERE id=?')
    .run(title_en??null, title_ka??null, excerpt_en??null, excerpt_ka??null, content??null, category??null, featured!==undefined?(featured?1:0):null, emoji??null, req.params.id);
  res.json({ success: true });
});

app.delete('/api/news/:id', authMiddleware, adminOrMod, (req, res) => {
  db.prepare('DELETE FROM news WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ─── CHAT ─────────────────────────────────────────────────────────────────────
app.get('/api/chat', (req, res) => {
  res.json(db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT 100').all().reverse());
});

app.post('/api/chat', authMiddleware, (req, res) => {
  const setting = db.prepare('SELECT value FROM settings WHERE key=?').get('chatEnabled');
  if (setting?.value === 'false' && req.user.role !== 'admin') return res.status(403).json({ error: 'Chat is disabled' });
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Empty message' });
  const time = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  const r = db.prepare(`INSERT INTO chat_messages (user_id,username,role,avatar,text,time,is_ai,created_at) VALUES (?,?,?,?,?,?,0,?)`).run(req.user.id, req.user.username, req.user.role, req.user.avatar||'🎵', text.trim(), time, new Date().toISOString());
  res.json(db.prepare('SELECT * FROM chat_messages WHERE id=?').get(r.lastInsertRowid));
});

app.post('/api/chat/ai', authMiddleware, (req, res) => {
  const { text, username, avatar } = req.body;
  const time = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  const r = db.prepare(`INSERT INTO chat_messages (user_id,username,role,avatar,text,time,is_ai,created_at) VALUES (0,?,?,?,?,?,1,?)`).run(username||'FlowBot', avatar||'🤖', text, time, new Date().toISOString());
  res.json(db.prepare('SELECT * FROM chat_messages WHERE id=?').get(r.lastInsertRowid));
});

app.delete('/api/chat/:id', authMiddleware, adminOrMod, (req, res) => {
  db.prepare('DELETE FROM chat_messages WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

app.delete('/api/chat', authMiddleware, adminOnly, (req, res) => {
  db.prepare('DELETE FROM chat_messages').run();
  res.json({ success: true });
});

// ─── REPORTS ──────────────────────────────────────────────────────────────────
app.get('/api/reports', authMiddleware, adminOrMod, (req, res) => {
  res.json(db.prepare('SELECT * FROM reports ORDER BY id DESC').all());
});

app.post('/api/reports', authMiddleware, (req, res) => {
  const { reported, reason } = req.body;
  if (!reported || !reason) return res.status(400).json({ error: 'reported and reason required' });
  const date = new Date().toISOString().slice(0, 10);
  const r = db.prepare(`INSERT INTO reports (reporter,reported,reason,status,date) VALUES (?,?,?,'pending',?)`).run(req.user.username, reported, reason, date);
  res.json(db.prepare('SELECT * FROM reports WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/reports/:id', authMiddleware, adminOrMod, (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE reports SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ success: true });
});

// ─── BANNERS ──────────────────────────────────────────────────────────────────
app.get('/api/banners', (req, res) => {
  res.json(db.prepare('SELECT * FROM banners ORDER BY id DESC').all().map(b => ({ ...b, active: !!b.active })));
});

app.post('/api/banners', authMiddleware, adminOrDesigner, (req, res) => {
  const { title, emoji, color } = req.body;
  const r = db.prepare(`INSERT INTO banners (title,emoji,color,active) VALUES (?,?,?,0)`).run(title, emoji||'🎤', color||'linear-gradient(135deg,#1a0505,#0a0a1a)');
  res.json(db.prepare('SELECT * FROM banners WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/banners/:id', authMiddleware, adminOrDesigner, (req, res) => {
  const { title, emoji, color, active } = req.body;
  if (active) db.prepare('UPDATE banners SET active=0').run();
  db.prepare('UPDATE banners SET title=COALESCE(?,title), emoji=COALESCE(?,emoji), color=COALESCE(?,color), active=COALESCE(?,active) WHERE id=?')
    .run(title??null, emoji??null, color??null, active!==undefined?(active?1:0):null, req.params.id);
  res.json({ success: true });
});

app.delete('/api/banners/:id', authMiddleware, adminOrDesigner, (req, res) => {
  db.prepare('DELETE FROM banners WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const obj = {};
  rows.forEach(r => { obj[r.key] = r.value === 'true' ? true : r.value === 'false' ? false : r.value; });
  res.json(obj);
});

app.put('/api/settings', authMiddleware, adminOnly, (req, res) => {
  const set = db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)`);
  Object.entries(req.body).forEach(([k, v]) => set.run(k, String(v)));
  res.json({ success: true });
});

// ─── DESIGN CONFIG ────────────────────────────────────────────────────────────
app.get('/api/design', (req, res) => {
  const row = db.prepare('SELECT value FROM design_config WHERE key=?').get('config');
  try { res.json(JSON.parse(row?.value || '{}')); }
  catch { res.json({}); }
});

app.put('/api/design', authMiddleware, adminOnly, (req, res) => {
  db.prepare('INSERT OR REPLACE INTO design_config (key,value) VALUES (?,?)').run('config', JSON.stringify(req.body));
  res.json({ success: true });
});

// ─── SCORES ───────────────────────────────────────────────────────────────────
app.get('/api/scores/:battleId', authMiddleware, adminOrJudge, (req, res) => {
  res.json(db.prepare('SELECT * FROM scores WHERE battle_id=?').all(req.params.battleId));
});

app.post('/api/scores', authMiddleware, adminOrJudge, (req, res) => {
  const { battle_id, technique1, delivery1, content1, technique2, delivery2, content2 } = req.body;
  const existing = db.prepare('SELECT id FROM scores WHERE judge_id=? AND battle_id=?').get(req.user.id, battle_id);
  if (existing) {
    db.prepare('UPDATE scores SET technique1=?,delivery1=?,content1=?,technique2=?,delivery2=?,content2=? WHERE id=?').run(technique1, delivery1, content1, technique2, delivery2, content2, existing.id);
  } else {
    db.prepare(`INSERT INTO scores (judge_id,battle_id,technique1,delivery1,content1,technique2,delivery2,content2,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(req.user.id, battle_id, technique1, delivery1, content1, technique2, delivery2, content2, new Date().toISOString());
  }
  res.json({ success: true });
});

// ─── ADMIN: FULL DB RESET ─────────────────────────────────────────────────────
app.post('/api/admin/reset', authMiddleware, adminOnly, checkAdminIP, (req, res) => {
  ['battles','battle_comments','news','chat_messages','reports','banners','votes','follows','scores'].forEach(t => {
    db.prepare(`DELETE FROM ${t}`).run();
  });
  db.prepare("DELETE FROM users WHERE id != 1").run();
  db.prepare("UPDATE users SET battles_count=0, wins=0 WHERE id=1").run();
  res.json({ success: true });
});

// ─── STATS ────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const battles = db.prepare('SELECT status,SUM(votes1+votes2) as votes, SUM(views) as views FROM battles GROUP BY status').all();
  const totalVotes = battles.reduce((s, b) => s + (b.votes||0), 0);
  const totalViews = battles.reduce((s, b) => s + (b.views||0), 0);
  const liveBattles = (db.prepare("SELECT COUNT(*) as c FROM battles WHERE status='live'").get().c);
  res.json({
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    battles: db.prepare('SELECT COUNT(*) as c FROM battles').get().c,
    rappers: db.prepare('SELECT COUNT(*) as c FROM rappers').get().c,
    liveBattles, totalVotes, totalViews,
    news: db.prepare('SELECT COUNT(*) as c FROM news').get().c,
    pendingReports: db.prepare("SELECT COUNT(*) as c FROM reports WHERE status='pending'").get().c,
    bannedUsers: db.prepare('SELECT COUNT(*) as c FROM users WHERE banned=1').get().c,
    chatMessages: db.prepare('SELECT COUNT(*) as c FROM chat_messages').get().c,
  });
});

// ─── SPA FALLBACK ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎤 Flow & Bars running on http://localhost:${PORT}`);
  console.log(`🔒 Admin IP restriction: ${ADMIN_IP}`);
  console.log(`📦 Database: ${path.join(__dirname, 'database.db')}\n`);
});
