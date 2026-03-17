# 🎤 Flow & Bars — Georgia's #1 Rap Battle Platform

Production-ready Node.js + SQLite + React application.

---

## 🚀 Quick Deploy

### Requirements
- Node.js 18+
- NPM

### Local Setup
```bash
npm install
npm start
# → http://localhost:3000
```

### Production (Ubuntu/Debian VPS)
```bash
# 1. Upload files to your server
scp -r flow-and-bars/ user@your-server:/var/www/

# 2. Install dependencies
cd /var/www/flow-and-bars
npm install --production

# 3. Install PM2 process manager
npm install -g pm2

# 4. Start with PM2
PORT=3000 ADMIN_IP=176.74.94.221 JWT_SECRET=your-ultra-secret-key pm2 start server.js --name flowbars

# 5. Auto-restart on reboot
pm2 save
pm2 startup
```

### Nginx Reverse Proxy
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Environment Variables
| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `JWT_SECRET` | built-in | Change in production! |
| `ADMIN_IP` | `176.74.94.221` | Only this IP can log in as admin |

---

## 🔐 Security

- **Admin login is IP-restricted** — only `176.74.94.221` can log in as admin
- JWT tokens expire in 7 days
- Rate limiting on login (20 req/15min) and API (500 req/15min)
- Passwords hashed with bcrypt (10 rounds)
- SQLite WAL mode for performance

---

## 👤 Default Credentials

| Username | Password | Role |
|---|---|---|
| admin | Admin@FlowBars2026! | Admin (IP-restricted) |
| mod1 | mod123 | Moderator |
| designer1 | des123 | Designer |
| judge1 | judge123 | Judge |
| IceKing | bat123 | Battler |
| GhostFlow | ghost123 | Battler |
| TbilisiBars | tb123 | Battler |
| user1 | user123 | User |

> ⚠️ Change all passwords after first deploy!

---

## 🎨 Design Mode

- Log in as **Admin** from IP `176.74.94.221`
- Click **"🎨 Design Mode"** button (bottom-right)
- A slide-in panel gives full control:
  - **Colors** — primary, accent, gold, background, text + quick presets
  - **Content** — hero title, subtitle, footer text
  - **Sections** — show/hide hero, stats bar, battles, rappers, news
  - **CSS** — inject custom CSS globally
- Click **Save Design** — changes persist in database
- All visitors see updated design instantly

---

## 🗄️ Database

SQLite file: `database.db` (auto-created on first run)

Tables: `users`, `rappers`, `battles`, `battle_comments`, `news`, `chat_messages`, `reports`, `banners`, `settings`, `design_config`, `votes`, `follows`, `scores`

---

## 📡 API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/auth/login | — | Login |
| POST | /api/auth/register | — | Register |
| GET | /api/auth/me | ✓ | Current user |
| GET | /api/battles | — | All battles |
| POST | /api/battles/:id/vote | ✓ | Vote |
| GET | /api/rappers | — | All rappers |
| POST | /api/rappers/:id/follow | ✓ | Follow |
| GET | /api/chat | — | Chat messages |
| POST | /api/chat | ✓ | Send message |
| GET | /api/news | — | All news |
| GET | /api/settings | — | Platform settings |
| GET | /api/design | — | Design config |
| PUT | /api/design | Admin | Update design |
| GET | /api/stats | — | Platform stats |

Full CRUD available for admin role on all resources.
