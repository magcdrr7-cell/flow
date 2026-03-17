'use strict';
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'flowbars-2026-secret';

const db = new Database(path.join(__dirname, 'database.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
    email TEXT DEFAULT '', role TEXT DEFAULT 'user',
    bio TEXT DEFAULT '', avatar TEXT DEFAULT '🎵',
    banned INTEGER DEFAULT 0, joined TEXT,
    battles_count INTEGER DEFAULT 0, wins INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS rappers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL, real_name TEXT DEFAULT '',
    city TEXT DEFAULT '', emoji TEXT DEFAULT '🎤',
    wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0,
    pts INTEGER DEFAULT 0, followers INTEGER DEFAULT 0,
    bio TEXT DEFAULT '', style TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, rapper1 TEXT DEFAULT '', rapper2 TEXT DEFAULT '',
    rapper1_id INTEGER DEFAULT 0, rapper2_id INTEGER DEFAULT 0,
    status TEXT DEFAULT 'upcoming', round TEXT DEFAULT 'Round 1',
    votes1 INTEGER DEFAULT 0, votes2 INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0, featured INTEGER DEFAULT 0,
    date TEXT, winner TEXT
  );
  CREATE TABLE IF NOT EXISTS battle_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    battle_id INTEGER, user_id INTEGER,
    username TEXT, role TEXT, avatar TEXT, text TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_en TEXT DEFAULT '', title_ka TEXT DEFAULT '',
    excerpt_en TEXT DEFAULT '', excerpt_ka TEXT DEFAULT '',
    content TEXT DEFAULT '', category TEXT DEFAULT 'News',
    author TEXT DEFAULT '', date TEXT,
    featured INTEGER DEFAULT 0, emoji TEXT DEFAULT '📰'
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT 0, username TEXT,
    role TEXT DEFAULT 'user', avatar TEXT DEFAULT '🎵',
    text TEXT, time TEXT, is_ai INTEGER DEFAULT 0, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter TEXT, reported TEXT, reason TEXT,
    status TEXT DEFAULT 'pending', date TEXT
  );
  CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT, emoji TEXT DEFAULT '🎤',
    color TEXT DEFAULT 'linear-gradient(135deg,#1a0505,#0a0a1a)',
    active INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS design_config (key TEXT PRIMARY KEY, value TEXT);
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

function init() {
  // Admin is always re-upserted so password changes via env take effect
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@FlowBars2026!';
  db.prepare(`INSERT OR REPLACE INTO users
    (id,username,password,email,role,bio,avatar,banned,joined)
    VALUES(1,'admin',?,'admin@flowbars.ge','admin','Platform Administrator','👑',0,?)
  `).run(bcrypt.hashSync(adminPassword, 10), new Date().toISOString().slice(0,10));

  // Only set defaults once — never overwrite user changes
  const si = db.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)`);
  [['siteName','Flow & Bars'],['seasonText','Season 1'],
   ['maintenanceMode','false'],['registrationOpen','true'],['chatEnabled','true']
  ].forEach(s => si.run(...s));

  db.prepare(`INSERT OR IGNORE INTO design_config (key,value) VALUES ('config',?)`).run(
    JSON.stringify({
      colors:{primary:'#FF2D55',accent:'#00D4FF',gold:'#FFD700',bg:'#070707',text:'#e8e8e8'},
      heroTitle1:'FLOW', heroTitle2:'& BARS',
      heroSubtitle:"Georgia's #1 rap battle platform.",
      footerText:"Georgia's #1 Rap Platform",
      sections:{hero:true,statBar:true,battles:true,rappers:true,news:true},
      customCSS:''
    })
  );
  console.log(`🎤 Flow & Bars | port ${PORT} | admin pw from ${process.env.ADMIN_PASSWORD?'env':'default'}`);
}
init();

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.set('trust proxy', true);
app.use(cors({origin:'*',credentials:true}));
app.use(express.json({limit:'2mb'}));
app.use(express.static(path.join(__dirname,'public')));

function auth(req,res,next){
  const token=req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({error:'No token'});
  try{
    const dec=jwt.verify(token,JWT_SECRET);
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(dec.id);
    if(!user||user.banned) return res.status(403).json({error:'Forbidden'});
    req.user=user; next();
  }catch{ return res.status(401).json({error:'Invalid token'}); }
}
const adminOnly=(req,res,next)=>req.user?.role==='admin'?next():res.status(403).json({error:'Admin only'});
const modOrAdmin=(req,res,next)=>['admin','moderator'].includes(req.user?.role)?next():res.status(403).json({error:'No permission'});
const desOrAdmin=(req,res,next)=>['admin','designer'].includes(req.user?.role)?next():res.status(403).json({error:'No permission'});
const judgeOrAdmin=(req,res,next)=>['admin','judge'].includes(req.user?.role)?next():res.status(403).json({error:'No permission'});

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login',(req,res)=>{
  const {username,password}=req.body;
  if(!username||!password) return res.status(400).json({error:'Username and password required'});
  const user=db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if(!user||!bcrypt.compareSync(password,user.password)) return res.status(401).json({error:'Invalid credentials'});
  if(user.banned) return res.status(403).json({error:'Account is banned'});
  const token=jwt.sign({id:user.id,username:user.username,role:user.role},JWT_SECRET,{expiresIn:'7d'});
  const {password:_,...safe}=user;
  res.json({token,user:safe});
});

app.post('/api/auth/register',(req,res)=>{
  const open=db.prepare("SELECT value FROM settings WHERE key='registrationOpen'").get();
  if(open?.value==='false') return res.status(403).json({error:'Registration is closed'});
  const {username,email,password}=req.body;
  if(!username||!password||!email) return res.status(400).json({error:'All fields required'});
  if(username.length<3) return res.status(400).json({error:'Username too short (min 3)'});
  if(password.length<6) return res.status(400).json({error:'Password too short (min 6)'});
  try{
    const joined=new Date().toISOString().slice(0,10);
    const r=db.prepare(`INSERT INTO users(username,password,email,role,bio,avatar,joined)VALUES(?,?,?,'user','','🎵',?)`).run(username,bcrypt.hashSync(password,10),email,joined);
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
    const token=jwt.sign({id:user.id,username:user.username,role:user.role},JWT_SECRET,{expiresIn:'7d'});
    const {password:_,...safe}=user;
    res.json({token,user:safe});
  }catch{ res.status(409).json({error:'Username already taken'}); }
});

app.get('/api/auth/me',auth,(req,res)=>{const{password:_,...s}=req.user;res.json(s);});

// ─── USERS ────────────────────────────────────────────────────────────────────
app.get('/api/users',auth,modOrAdmin,(req,res)=>{
  res.json(db.prepare('SELECT id,username,email,role,bio,avatar,banned,joined,battles_count,wins FROM users ORDER BY id').all());
});
app.put('/api/users/:id',auth,adminOnly,(req,res)=>{
  const id=Number(req.params.id);
  const {role,banned,bio,email,avatar}=req.body;
  if(id===1&&role&&role!=='admin') return res.status(403).json({error:'Cannot demote super admin'});

  // Get current user state before update
  const user=db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if(!user) return res.status(404).json({error:'User not found'});

  db.prepare(`UPDATE users SET role=COALESCE(?,role),banned=COALESCE(?,banned),bio=COALESCE(?,bio),email=COALESCE(?,email),avatar=COALESCE(?,avatar) WHERE id=?`)
    .run(role??null,banned!==undefined?(banned?1:0):null,bio??null,email??null,avatar??null,id);

  // Auto-sync rappers table when battler role changes
  if(role==='battler'){
    // Add to rappers if not already there
    db.prepare(`INSERT OR IGNORE INTO rappers(username,real_name,city,emoji,bio,style)VALUES(?,?,?,?,?,?)`)
      .run(user.username,'','',(user.avatar||'🎤'),user.bio||'','');
  } else if(role&&role!=='battler'&&user.role==='battler'){
    // Remove from rappers when role is taken away
    db.prepare('DELETE FROM rappers WHERE username=?').run(user.username);
  }

  res.json({success:true});
});
app.delete('/api/users/:id',auth,adminOnly,(req,res)=>{
  if(req.params.id==='1') return res.status(403).json({error:'Cannot delete super admin'});
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({success:true});
});
app.put('/api/users/me/profile',auth,(req,res)=>{
  const {bio,email}=req.body;
  db.prepare('UPDATE users SET bio=COALESCE(?,bio),email=COALESCE(?,email) WHERE id=?').run(bio??null,email??null,req.user.id);
  res.json({success:true});
});

// ─── RAPPERS ──────────────────────────────────────────────────────────────────
app.get('/api/rappers',(req,res)=>res.json(db.prepare('SELECT * FROM rappers ORDER BY pts DESC').all()));
app.get('/api/rappers/:id',(req,res)=>{
  const r=db.prepare('SELECT * FROM rappers WHERE id=?').get(req.params.id);
  if(!r) return res.status(404).json({error:'Not found'});
  res.json(r);
});
app.post('/api/rappers',auth,adminOnly,(req,res)=>{
  const {username,real_name,city,emoji,bio,style}=req.body;
  if(!username) return res.status(400).json({error:'Username required'});
  try{
    const r=db.prepare(`INSERT INTO rappers(username,real_name,city,emoji,bio,style)VALUES(?,?,?,?,?,?)`).run(username,real_name||'',city||'',emoji||'🎤',bio||'',style||'');
    res.json(db.prepare('SELECT * FROM rappers WHERE id=?').get(r.lastInsertRowid));
  }catch{ res.status(409).json({error:'Rapper already exists'}); }
});
app.put('/api/rappers/:id',auth,adminOnly,(req,res)=>{
  const {username,real_name,city,emoji,wins,losses,pts,bio,style}=req.body;
  db.prepare(`UPDATE rappers SET username=COALESCE(?,username),real_name=COALESCE(?,real_name),city=COALESCE(?,city),emoji=COALESCE(?,emoji),wins=COALESCE(?,wins),losses=COALESCE(?,losses),pts=COALESCE(?,pts),bio=COALESCE(?,bio),style=COALESCE(?,style) WHERE id=?`)
    .run(username??null,real_name??null,city??null,emoji??null,wins??null,losses??null,pts??null,bio??null,style??null,req.params.id);
  res.json({success:true});
});
app.delete('/api/rappers/:id',auth,adminOnly,(req,res)=>{db.prepare('DELETE FROM rappers WHERE id=?').run(req.params.id);res.json({success:true});});
app.post('/api/rappers/:id/follow',auth,(req,res)=>{
  const rid=Number(req.params.id),uid=req.user.id;
  const ex=db.prepare('SELECT 1 FROM follows WHERE user_id=? AND rapper_id=?').get(uid,rid);
  if(ex){db.prepare('DELETE FROM follows WHERE user_id=? AND rapper_id=?').run(uid,rid);db.prepare('UPDATE rappers SET followers=MAX(0,followers-1) WHERE id=?').run(rid);res.json({following:false});}
  else{db.prepare('INSERT INTO follows(user_id,rapper_id)VALUES(?,?)').run(uid,rid);db.prepare('UPDATE rappers SET followers=followers+1 WHERE id=?').run(rid);res.json({following:true});}
});
app.get('/api/rappers/:id/following',auth,(req,res)=>{res.json({following:!!db.prepare('SELECT 1 FROM follows WHERE user_id=? AND rapper_id=?').get(req.user.id,req.params.id)});});
app.get('/api/follows',auth,(req,res)=>res.json(db.prepare('SELECT rapper_id FROM follows WHERE user_id=?').all(req.user.id).map(r=>r.rapper_id)));

// ─── BATTLES ──────────────────────────────────────────────────────────────────
app.get('/api/battles',(req,res)=>res.json(db.prepare('SELECT * FROM battles ORDER BY id DESC').all().map(b=>({...b,featured:!!b.featured}))));
app.get('/api/battles/:id',(req,res)=>{
  const b=db.prepare('SELECT * FROM battles WHERE id=?').get(req.params.id);
  if(!b) return res.status(404).json({error:'Not found'});
  const comments=db.prepare('SELECT * FROM battle_comments WHERE battle_id=? ORDER BY id').all(req.params.id);
  res.json({...b,featured:!!b.featured,comments});
});
app.post('/api/battles',auth,adminOnly,(req,res)=>{
  const {title,rapper1,rapper2,rapper1_id,rapper2_id,status,round}=req.body;
  if(!title) return res.status(400).json({error:'Title required'});
  const r=db.prepare(`INSERT INTO battles(title,rapper1,rapper2,rapper1_id,rapper2_id,status,round,date)VALUES(?,?,?,?,?,?,?,?)`).run(title,rapper1||'',rapper2||'',rapper1_id||0,rapper2_id||0,status||'upcoming',round||'Round 1',new Date().toISOString().slice(0,10));
  res.json(db.prepare('SELECT * FROM battles WHERE id=?').get(r.lastInsertRowid));
});
app.put('/api/battles/:id',auth,adminOnly,(req,res)=>{
  const {title,status,round,winner,featured,rapper1,rapper2,rapper1_id,rapper2_id}=req.body;
  db.prepare(`UPDATE battles SET title=COALESCE(?,title),status=COALESCE(?,status),round=COALESCE(?,round),winner=COALESCE(?,winner),featured=COALESCE(?,featured),rapper1=COALESCE(?,rapper1),rapper2=COALESCE(?,rapper2),rapper1_id=COALESCE(?,rapper1_id),rapper2_id=COALESCE(?,rapper2_id) WHERE id=?`)
    .run(title??null,status??null,round??null,winner??null,featured!==undefined?(featured?1:0):null,rapper1??null,rapper2??null,rapper1_id??null,rapper2_id??null,req.params.id);
  res.json({success:true});
});
app.delete('/api/battles/:id',auth,adminOnly,(req,res)=>{
  db.prepare('DELETE FROM battles WHERE id=?').run(req.params.id);
  db.prepare('DELETE FROM battle_comments WHERE battle_id=?').run(req.params.id);
  db.prepare('DELETE FROM votes WHERE battle_id=?').run(req.params.id);
  res.json({success:true});
});
app.post('/api/battles/:id/vote',auth,(req,res)=>{
  const {side}=req.body;
  if(!['a','b'].includes(side)) return res.status(400).json({error:'side must be a or b'});
  const b=db.prepare('SELECT * FROM battles WHERE id=?').get(req.params.id);
  if(!b) return res.status(404).json({error:'Not found'});
  if(b.status!=='live') return res.status(400).json({error:'Battle is not live'});
  if(db.prepare('SELECT 1 FROM votes WHERE user_id=? AND battle_id=?').get(req.user.id,req.params.id)) return res.status(409).json({error:'Already voted'});
  db.prepare('INSERT INTO votes(user_id,battle_id,side)VALUES(?,?,?)').run(req.user.id,req.params.id,side);
  db.prepare(`UPDATE battles SET ${side==='a'?'votes1':'votes2'}=${side==='a'?'votes1':'votes2'}+1 WHERE id=?`).run(req.params.id);
  res.json({success:true});
});
app.get('/api/battles/:id/myvote',auth,(req,res)=>{const v=db.prepare('SELECT side FROM votes WHERE user_id=? AND battle_id=?').get(req.user.id,req.params.id);res.json({side:v?.side||null});});
app.post('/api/battles/:id/comments',auth,(req,res)=>{
  const {text}=req.body;
  if(!text?.trim()) return res.status(400).json({error:'Empty comment'});
  const r=db.prepare(`INSERT INTO battle_comments(battle_id,user_id,username,role,avatar,text,created_at)VALUES(?,?,?,?,?,?,?)`).run(req.params.id,req.user.id,req.user.username,req.user.role,req.user.avatar,text.trim(),new Date().toISOString());
  res.json(db.prepare('SELECT * FROM battle_comments WHERE id=?').get(r.lastInsertRowid));
});
app.delete('/api/battles/:bid/comments/:cid',auth,modOrAdmin,(req,res)=>{db.prepare('DELETE FROM battle_comments WHERE id=? AND battle_id=?').run(req.params.cid,req.params.bid);res.json({success:true});});

// ─── NEWS ─────────────────────────────────────────────────────────────────────
app.get('/api/news',(req,res)=>res.json(db.prepare('SELECT * FROM news ORDER BY id DESC').all()));
app.get('/api/news/:id',(req,res)=>{const a=db.prepare('SELECT * FROM news WHERE id=?').get(req.params.id);if(!a)return res.status(404).json({error:'Not found'});res.json(a);});
app.post('/api/news',auth,modOrAdmin,(req,res)=>{
  const {title_en,title_ka,excerpt_en,excerpt_ka,content,category,emoji,featured}=req.body;
  if(!title_en) return res.status(400).json({error:'title_en required'});
  const r=db.prepare(`INSERT INTO news(title_en,title_ka,excerpt_en,excerpt_ka,content,category,author,date,featured,emoji)VALUES(?,?,?,?,?,?,?,?,?,?)`).run(title_en,title_ka||'',excerpt_en||'',excerpt_ka||'',content||'',category||'News',req.user.username,new Date().toISOString().slice(0,10),featured?1:0,emoji||'📰');
  res.json(db.prepare('SELECT * FROM news WHERE id=?').get(r.lastInsertRowid));
});
app.put('/api/news/:id',auth,modOrAdmin,(req,res)=>{
  const {title_en,title_ka,excerpt_en,excerpt_ka,content,category,featured,emoji}=req.body;
  db.prepare(`UPDATE news SET title_en=COALESCE(?,title_en),title_ka=COALESCE(?,title_ka),excerpt_en=COALESCE(?,excerpt_en),excerpt_ka=COALESCE(?,excerpt_ka),content=COALESCE(?,content),category=COALESCE(?,category),featured=COALESCE(?,featured),emoji=COALESCE(?,emoji) WHERE id=?`)
    .run(title_en??null,title_ka??null,excerpt_en??null,excerpt_ka??null,content??null,category??null,featured!==undefined?(featured?1:0):null,emoji??null,req.params.id);
  res.json({success:true});
});
app.delete('/api/news/:id',auth,modOrAdmin,(req,res)=>{db.prepare('DELETE FROM news WHERE id=?').run(req.params.id);res.json({success:true});});

// ─── CHAT ─────────────────────────────────────────────────────────────────────
app.get('/api/chat',(req,res)=>res.json(db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT 100').all().reverse()));
app.post('/api/chat',auth,(req,res)=>{
  const chatOn=db.prepare("SELECT value FROM settings WHERE key='chatEnabled'").get();
  if(chatOn?.value==='false'&&req.user.role!=='admin') return res.status(403).json({error:'Chat is disabled'});
  const {text}=req.body;
  if(!text?.trim()) return res.status(400).json({error:'Empty message'});
  const time=new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'});
  const r=db.prepare(`INSERT INTO chat_messages(user_id,username,role,avatar,text,time,is_ai,created_at)VALUES(?,?,?,?,?,?,0,?)`).run(req.user.id,req.user.username,req.user.role,req.user.avatar||'🎵',text.trim(),time,new Date().toISOString());
  res.json(db.prepare('SELECT * FROM chat_messages WHERE id=?').get(r.lastInsertRowid));
});
app.post('/api/chat/ai',auth,(req,res)=>{
  const {text,username,avatar}=req.body;
  const time=new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'});
  const r=db.prepare(`INSERT INTO chat_messages(user_id,username,role,avatar,text,time,is_ai,created_at)VALUES(0,?,'user',?,?,?,1,?)`).run(username||'FlowBot',avatar||'🤖',text,time,new Date().toISOString());
  res.json(db.prepare('SELECT * FROM chat_messages WHERE id=?').get(r.lastInsertRowid));
});
app.delete('/api/chat/:id',auth,modOrAdmin,(req,res)=>{db.prepare('DELETE FROM chat_messages WHERE id=?').run(req.params.id);res.json({success:true});});
app.delete('/api/chat',auth,adminOnly,(req,res)=>{db.prepare('DELETE FROM chat_messages').run();res.json({success:true});});

// ─── REPORTS ──────────────────────────────────────────────────────────────────
app.get('/api/reports',auth,modOrAdmin,(req,res)=>res.json(db.prepare('SELECT * FROM reports ORDER BY id DESC').all()));
app.post('/api/reports',auth,(req,res)=>{
  const {reported,reason}=req.body;
  if(!reported||!reason) return res.status(400).json({error:'reported and reason required'});
  const r=db.prepare(`INSERT INTO reports(reporter,reported,reason,status,date)VALUES(?,?,?,'pending',?)`).run(req.user.username,reported,reason,new Date().toISOString().slice(0,10));
  res.json(db.prepare('SELECT * FROM reports WHERE id=?').get(r.lastInsertRowid));
});
app.put('/api/reports/:id',auth,modOrAdmin,(req,res)=>{db.prepare('UPDATE reports SET status=? WHERE id=?').run(req.body.status,req.params.id);res.json({success:true});});

// ─── BANNERS ──────────────────────────────────────────────────────────────────
app.get('/api/banners',(req,res)=>res.json(db.prepare('SELECT * FROM banners ORDER BY id DESC').all().map(b=>({...b,active:!!b.active}))));
app.post('/api/banners',auth,desOrAdmin,(req,res)=>{
  const {title,emoji,color}=req.body;
  if(!title) return res.status(400).json({error:'Title required'});
  const r=db.prepare(`INSERT INTO banners(title,emoji,color,active)VALUES(?,?,?,0)`).run(title,emoji||'🎤',color||'linear-gradient(135deg,#1a0505,#0a0a1a)');
  res.json(db.prepare('SELECT * FROM banners WHERE id=?').get(r.lastInsertRowid));
});
app.put('/api/banners/:id',auth,desOrAdmin,(req,res)=>{
  const {title,emoji,color,active}=req.body;
  if(active) db.prepare('UPDATE banners SET active=0').run();
  db.prepare(`UPDATE banners SET title=COALESCE(?,title),emoji=COALESCE(?,emoji),color=COALESCE(?,color),active=COALESCE(?,active) WHERE id=?`)
    .run(title??null,emoji??null,color??null,active!==undefined?(active?1:0):null,req.params.id);
  res.json({success:true});
});
app.delete('/api/banners/:id',auth,desOrAdmin,(req,res)=>{db.prepare('DELETE FROM banners WHERE id=?').run(req.params.id);res.json({success:true});});

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
app.get('/api/settings',(req,res)=>{
  const rows=db.prepare('SELECT key,value FROM settings').all();
  const obj={};
  rows.forEach(r=>{obj[r.key]=r.value==='true'?true:r.value==='false'?false:r.value;});
  res.json(obj);
});
app.put('/api/settings',auth,adminOnly,(req,res)=>{
  const s=db.prepare(`INSERT OR REPLACE INTO settings(key,value)VALUES(?,?)`);
  Object.entries(req.body).forEach(([k,v])=>s.run(k,String(v)));
  res.json({success:true});
});

// ─── DESIGN ───────────────────────────────────────────────────────────────────
app.get('/api/design',(req,res)=>{
  const row=db.prepare("SELECT value FROM design_config WHERE key='config'").get();
  try{res.json(JSON.parse(row?.value||'{}'));}catch{res.json({});}
});
app.put('/api/design',auth,adminOnly,(req,res)=>{
  db.prepare(`INSERT OR REPLACE INTO design_config(key,value)VALUES('config',?)`).run(JSON.stringify(req.body));
  res.json({success:true});
});

// ─── SCORES ───────────────────────────────────────────────────────────────────
app.get('/api/scores/:battleId',auth,judgeOrAdmin,(req,res)=>res.json(db.prepare('SELECT * FROM scores WHERE battle_id=?').all(req.params.battleId)));
app.post('/api/scores',auth,judgeOrAdmin,(req,res)=>{
  const {battle_id,technique1,delivery1,content1,technique2,delivery2,content2}=req.body;
  const ex=db.prepare('SELECT id FROM scores WHERE judge_id=? AND battle_id=?').get(req.user.id,battle_id);
  if(ex){db.prepare(`UPDATE scores SET technique1=?,delivery1=?,content1=?,technique2=?,delivery2=?,content2=? WHERE id=?`).run(technique1,delivery1,content1,technique2,delivery2,content2,ex.id);}
  else{db.prepare(`INSERT INTO scores(judge_id,battle_id,technique1,delivery1,content1,technique2,delivery2,content2,created_at)VALUES(?,?,?,?,?,?,?,?,?)`).run(req.user.id,battle_id,technique1,delivery1,content1,technique2,delivery2,content2,new Date().toISOString());}
  res.json({success:true});
});

// ─── STATS ────────────────────────────────────────────────────────────────────
app.get('/api/stats',(req,res)=>res.json({
  users:          db.prepare('SELECT COUNT(*) as c FROM users').get().c,
  battles:        db.prepare('SELECT COUNT(*) as c FROM battles').get().c,
  rappers:        db.prepare('SELECT COUNT(*) as c FROM rappers').get().c,
  liveBattles:    db.prepare("SELECT COUNT(*) as c FROM battles WHERE status='live'").get().c,
  totalVotes:     db.prepare('SELECT COALESCE(SUM(votes1+votes2),0) as v FROM battles').get().v,
  totalViews:     db.prepare('SELECT COALESCE(SUM(views),0) as v FROM battles').get().v,
  news:           db.prepare('SELECT COUNT(*) as c FROM news').get().c,
  pendingReports: db.prepare("SELECT COUNT(*) as c FROM reports WHERE status='pending'").get().c,
  bannedUsers:    db.prepare('SELECT COUNT(*) as c FROM users WHERE banned=1').get().c,
  chatMessages:   db.prepare('SELECT COUNT(*) as c FROM chat_messages').get().c,
}));

// ─── ANTHROPIC PROXY (keeps API key server-side) ──────────────────────────────
app.post('/api/messages',auth,async(req,res)=>{
  const key=process.env.ANTHROPIC_API_KEY;
  if(!key) return res.status(503).json({error:'AI chat not configured (set ANTHROPIC_API_KEY env var)'});
  try{
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify(req.body)});
    res.json(await r.json());
  }catch(e){res.status(500).json({error:'AI request failed'});}
});

// ─── RESET ────────────────────────────────────────────────────────────────────
app.post('/api/admin/reset',auth,adminOnly,(req,res)=>{
  ['battles','battle_comments','news','chat_messages','reports','banners','votes','follows','scores'].forEach(t=>db.prepare(`DELETE FROM ${t}`).run());
  db.prepare('DELETE FROM users WHERE id!=1').run();
  res.json({success:true});
});

// ─── SPA FALLBACK ─────────────────────────────────────────────────────────────
app.use('/api/*',(req,res)=>res.status(404).json({error:'Not found'}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT,'0.0.0.0',()=>console.log(`🎤 Running on port ${PORT}`));
