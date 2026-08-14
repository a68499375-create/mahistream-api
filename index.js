import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import bigInt from "big-integer";
import admin from "firebase-admin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "db.json");

// ── CORS: izinkan domain web yang dipakai ────────────────────────
const ALLOWED_ORIGINS = [
  "https://mahistream.duckdns.org",
  "https://176.100.36.125.sslip.io",
  "https://mahistream.pages.dev",
  "https://localhost",
  "http://localhost:5173",
  "capacitor://localhost",
  "http://localhost",
];
const corsOrigin = (origin, cb) => {
  if (!origin || ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".pages.dev")) return cb(null, true);
  return cb(null, true);
};

// ── Firebase Admin (FCM) ─────────────────────────────────────────
const FCM_KEY_PATH = path.join(__dirname, "fcm-key.json");
if (fs.existsSync(FCM_KEY_PATH)) {
  const serviceAccount = JSON.parse(fs.readFileSync(FCM_KEY_PATH, "utf8"));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  console.log("  Firebase Admin initialized");
} else {
  console.warn("  fcm-key.json not found, FCM push disabled");
}

const app = express();
const PORT = process.env.PORT || 25774;
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: corsOrigin, credentials: true } });
setInterval(() => {
  console.log(`[STATUS] ${new Date().toISOString()} connected clients: ${io.engine?.clientsCount ?? '?'}`);
}, 30000);
const ADMIN_PW = process.env.ADMIN_PW || "adminbaikbanget";
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "a68499375@gmail.com").split(",").map(e => String(e).trim().toLowerCase()).filter(Boolean);
function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return a === b;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "843035088451-oftajg1gqg6e2tks7gp0tfuu27028769.apps.googleusercontent.com";

// ── PKCE Login States ─────────────────────────────────────────────
const loginStates = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of loginStates) {
    if (now - val.createdAt > 120000) loginStates.delete(key);
  }
}, 30000);

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: "10mb" }));

// ── Simple Rate Limiter ──────────────────────────────────────────
const rateMap = new Map();
setInterval(() => { rateMap.clear(); }, 60000);
function rateLimit(key, max = 30) {
  const now = Date.now();
  if (!rateMap.has(key)) rateMap.set(key, []);
  const hits = rateMap.get(key).filter(t => now - t < 60000);
  hits.push(now);
  rateMap.set(key, hits);
  return hits.length <= max;
}

// ── Input Sanitizer ──────────────────────────────────────────────
function sanitize(str) {
  if (typeof str !== "string") return str;
  return str.replace(/<[^>]*>/g, "").trim().slice(0, 2000);
}

// ── User Activity Log ─────────────────────────────────────────────
function logActivity(userId, action, req) {
  if (!DB.user_activities) DB.user_activities = [];
  DB.user_activities.push({
    id: DB.user_activities.length + 1,
    user_id: userId,
    action: action,
    ip: req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.ip || req.connection?.remoteAddress || "",
    user_agent: req.headers["user-agent"] || "",
    device: (req.headers["user-agent"] || "").includes("Mobile") ? "Mobile" : "Desktop",
    path: req.path,
    created_at: new Date().toISOString()
  });
  // Keep only last 10000 entries
  if (DB.user_activities.length > 10000) DB.user_activities = DB.user_activities.slice(-5000);
  save();
}


// ── Auth Middleware ───────────────────────────────────────────────
app.use("/api/", (req, res, next) => {
  // Public paths: always allowed
  const publicPaths = ["/config","/auth/register","/auth/login","/auth/google","/auth/link","/auth/me","/auth/init-login","/auth/callback","/auth/poll-login"];
  const isPublic = publicPaths.some(p => req.path === p || req.path.startsWith(p + "/"));
  if (isPublic || req.path.startsWith("/telegram/") || req.method === "OPTIONS") return next();
  // GET requests: private endpoints require auth
  const privateGetPaths = ["/history","/bookmarks","/favorites","/watchlist","/comments","/reviews"];
  const isPrivateGet = privateGetPaths.some(p => req.path === p || req.path.startsWith(p + "/"));
  if (req.method === "GET" && !isPrivateGet && req.path !== "/user/profile") return next();
  // POST/PUT/DELETE: require auth, UNLESS an admin key is supplied
  const adminKey = req.headers["x-admin-key"];
  if (adminKey && safeEq(adminKey, ADMIN_PW)) return next();
  const token = req.headers["x-auth-token"];
  if (!token) return res.status(401).json({ error: "auth_required", message: "Login diperlukan" });
  const user = DB.users.find(u => u.token === token);
  if (!user) return res.status(401).json({ error: "auth_required", message: "Sesi habis, login ulang" });
  req.user = user;
  next();
});


app.use("/api/", (req, res, next) => {
  if (req.method !== "GET" && req.path.startsWith("/admin/") && !rateLimit("adm:" + req.ip, 60)) return res.status(429).json({ error: "Terlalu banyak permintaan admin. Coba lagi nanti." });
  next();
});

// ── Maintenance mode ──────────────────────────────────────────────
app.use("/api/", (req, res, next) => {
  if (req.path.startsWith("/admin/") || req.path.startsWith("/auth/") || req.path.startsWith("/config")) return next();
  if (safeEq(req.headers["x-admin-key"], ADMIN_PW)) return next();
  if (!req.user) {
    const token = req.headers["x-auth-token"];
    if (token) {
      const u = DB.users.find(u => u.token === token);
      if (u) req.user = u;
    }
  }
  if (req.user && (req.user.role === 'dev' || req.user.role === 'admin')) return next();
  const m = readMaintenance();
  if (m.active || DB.maintenance) return res.status(503).json({ error: "maintenance", message: m.message || "Situs sedang dalam perbaikan" });
  next();
});

// Serve built frontend in production
const distPath = path.join(__dirname, "..", "mahistream-app", "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  console.log("  Serving frontend from:", distPath);
}

const MAINTENANCE_FILE = path.join(DATA_DIR, "maintenance.json");

function readMaintenance() {
  try {
    if (fs.existsSync(MAINTENANCE_FILE))
      return JSON.parse(fs.readFileSync(MAINTENANCE_FILE, "utf8"));
  } catch {}
  return { active: false, message: "MahiStream sedang dalam pemeliharaan. Kami akan kembali segera!" };
}

app.get("/maintenance.json", (req, res) => {
  res.json(readMaintenance());
});

// ── Helpers ───────────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// ── Telegram MTProto Client ───────────────────────────────────────
const TL_API_ID = 34237124;
const TL_API_HASH = "a0961d30eec5751d75c2e38f79eb651a";
const TL_BOT_TOKEN = "8601089687:AAEgi7zNTLOZJYoLJgPh9Po15QFN54Zym58";
const SESSION_PATH = path.join(__dirname, "tl_session.txt");

const TL_ENABLED = process.env.TG_DISABLED !== "1";

let stringSession = new StringSession("");
if (TL_ENABLED && fs.existsSync(SESSION_PATH)) {
  stringSession = new StringSession(fs.readFileSync(SESSION_PATH, "utf-8"));
}

let tlClient = TL_ENABLED
  ? new TelegramClient(stringSession, TL_API_ID, TL_API_HASH, {
      connectionRetries: 5,
    })
  : null;

(async () => {
  if (!TL_ENABLED) {
    console.log("Telegram MTProto disabled (TG_DISABLED=1).");
    return;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await tlClient.start({
        botAuthToken: TL_BOT_TOKEN,
      });
      console.log("✓ Telegram MTProto Client connected.");
      fs.writeFileSync(SESSION_PATH, tlClient.session.save());
      return;
    } catch (error) {
      const msg = (error && (error.errorMessage || error.message)) || "";
      if (msg.includes("AUTH_KEY_DUPLICATED") && attempt < 2) {
        console.warn("AUTH_KEY_DUPLICATED — regenerating session, attempt " + (attempt + 1));
        try { if (fs.existsSync(SESSION_PATH)) fs.unlinkSync(SESSION_PATH); } catch (e) {}
        stringSession = new StringSession("");
        tlClient = new TelegramClient(stringSession, TL_API_ID, TL_API_HASH, {
          connectionRetries: 5,
        });
        continue;
      }
      console.error("Failed to connect Telegram Client:", error);
      return;
    }
  }
})();

app.get("/api/telegram/:channel/:messageId", async (req, res) => {
  if (!rateLimit('tg:' + req.ip, 120)) return res.status(429).json({ error: 'Terlalu banyak permintaan' });
  try {
    const channel = req.params.channel;
    const messageId = parseInt(req.params.messageId);

    if (!tlClient || !tlClient.connected) {
      return res.status(503).json({ error: "Telegram client not ready" });
    }

    const messages = await tlClient.getMessages(channel, { ids: [messageId] });
    if (!messages || messages.length === 0 || !messages[0].media || !messages[0].media.document) {
      return res.status(404).json({ error: "Video tidak ditemukan di Telegram (Pastikan Bot adalah Admin di Channel)" });
    }

    const doc = messages[0].media.document;
    const fileSize = Number(doc.size);
    const mimeType = doc.mimeType || "video/mp4";
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": mimeType,
      });

      let bytesWritten = 0;
      for await (const chunk of tlClient.iterDownload({
        file: messages[0].media,
        requestSize: 1024 * 1024,
        offset: bigInt(start),
        limit: chunksize,
      })) {
        if (res.destroyed) break;
        
        const remaining = chunksize - bytesWritten;
        if (remaining <= 0) break;
        
        const toWrite = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
        bytesWritten += toWrite.length;
        
        if (!res.write(toWrite)) {
          await new Promise(resolve => res.once('drain', resolve));
        }
      }
      if (!res.destroyed) res.end();
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": mimeType,
      });

      for await (const chunk of tlClient.iterDownload({
        file: messages[0].media,
        requestSize: 1024 * 1024,
      })) {
        if (res.destroyed) break;
        if (!res.write(chunk)) {
          await new Promise(resolve => res.once('drain', resolve));
        }
      }
      if (!res.destroyed) res.end();
    }
  } catch (error) {
    console.error("Telegram Stream Error:", error?.message || error);
    if (!res.headersSent) res.status(500).json({ error: "Stream failed" });
  }
});


// ── Telegram Info (dimensi/resolusi) ─────────────────────────────
app.get("/api/tginfo/:channel/:messageId", async (req, res) => {
  if (!rateLimit('tginfo:' + req.ip, 120)) return res.status(429).json({ error: 'Terlalu banyak permintaan' });
  try {
    const channel = req.params.channel;
    const messageId = parseInt(req.params.messageId, 10);
    if (!tlClient || !tlClient.connected) return res.status(503).json({ error: "Telegram client not ready" });
    const messages = await tlClient.getMessages(channel, { ids: [messageId] });
    if (!messages || messages.length === 0 || !messages[0].media || !messages[0].media.document) {
      return res.status(404).json({ error: "Video tidak ditemukan di Telegram" });
    }
    const doc = messages[0].media.document;
    let width = 0, height = 0;
    if (Array.isArray(doc.attributes)) {
      for (const a of doc.attributes) {
        if (a && a.className === 'DocumentAttributeVideo' && typeof a.w === 'number') {
          width = a.w; height = a.h; break;
        }
      }
    }
    res.json({ ok: true, width, height, size: Number(doc.size), mime: doc.mimeType || '' });
  } catch (error) {
    console.error("Telegram Info Error:", error?.message || error);
    if (!res.headersSent) res.status(500).json({ error: error?.message || 'failed' });
  }
});

// ── GDrive Redirect & Proxy ───────────────────────────────────────
app.get("/api/gdrive/:id", (req, res) => {
  if (!rateLimit('gd:' + req.ip, 120)) return res.status(429).json({ error: 'Terlalu banyak permintaan' });
  const id = req.params.id;
  if (!id || !/^[a-zA-Z0-9_-]{10,}$/.test(id)) return res.status(400).json({ error: "ID tidak valid" });
  
  const url = `https://drive.usercontent.google.com/download?id=${id}&export=download&authuser=0&confirm=t`;
  const options = {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      ...(req.headers.range ? { Range: req.headers.range } : {})
    }
  };

  const fetchGDrive = (fetchUrl, fetchOptions, callback) => {
    https.get(fetchUrl, fetchOptions, (gRes) => {
      if (gRes.headers['set-cookie']) {
        const cookies = gRes.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
        fetchOptions.headers.Cookie = fetchOptions.headers.Cookie ? fetchOptions.headers.Cookie + '; ' + cookies : cookies;
      }
      
      const isHtml = gRes.headers['content-type'] && gRes.headers['content-type'].includes('text/html');
      
      if (isHtml) {
        let html = '';
        gRes.on('data', chunk => html += chunk);
        gRes.on('end', () => {
          const confirmMatch = html.match(/name="confirm"\s+value="([^"]+)"/i);
          const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/i);
          
          if (confirmMatch) {
            const confirmToken = confirmMatch[1];
            let newUrl = `${url}&confirm=${confirmToken}`;
            if (uuidMatch) {
              newUrl += `&uuid=${uuidMatch[1]}`;
            }
            fetchGDrive(newUrl, fetchOptions, callback);
          } else {
            // No confirm token found. Check if it's a Quota Exceeded error.
            if (html.includes('Quota exceeded') || html.includes('Too many users')) {
              // We return a special property in HTML or just handle it below
              callback(gRes, html, true); 
            } else {
              callback(gRes, html);
            }
          }
        });
      } else if (gRes.statusCode >= 300 && gRes.statusCode < 400 && gRes.headers.location) {
        // Normal redirect (often 302/303 to actual stream)
        const nextUrl = gRes.headers.location;
        https.get(nextUrl, fetchOptions, (redirectRes) => {
          callback(redirectRes);
        }).on('error', () => callback(gRes));
      } else {
        callback(gRes);
      }
    }).on('error', (err) => {
      res.status(500).json({ error: "Fetch failed" });
    });
  };

  fetchGDrive(url, options, (finalRes, htmlBody, isQuotaExceeded) => {
    if (res.headersSent) return;
    
    if (finalRes.statusCode === 404) {
      return res.status(404).json({ error: "Google Drive mengembalikan 404 Not Found. Pastikan file tidak terhapus dan aksesnya disetel ke 'Anyone with the link' (Siapa saja yang memiliki link)." });
    }
    
    if (isQuotaExceeded) {
      return res.status(429).json({ error: "Google Drive Limit (Quota Exceeded). File ini sudah terlalu banyak ditonton/diunduh hari ini. Silakan coba lagi dalam 24 jam." });
    }

    const allowed = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'];
    const cleanHeaders = {};
    for (const [k, v] of Object.entries(finalRes.headers || {})) {
      if (allowed.includes(k.toLowerCase())) {
        cleanHeaders[k] = v;
      }
    }
    if (cleanHeaders['content-disposition']) cleanHeaders['content-disposition'] = String(cleanHeaders['content-disposition']).replace(/attachment/i, 'inline');
    if (cleanHeaders['Content-Disposition']) cleanHeaders['Content-Disposition'] = String(cleanHeaders['Content-Disposition']).replace(/attachment/i, 'inline');
    cleanHeaders['access-control-allow-origin'] = '*';
    res.writeHead(finalRes.statusCode, cleanHeaders);
    if (htmlBody) {
      res.end(htmlBody);
    } else {
      finalRes.pipe(res);
    }
  });
});

// ── In-memory store ──────────────────────────────────────────────
let DB = {
  anime: [],
  episodes: [],
  requests: [],
  users: [],
  history: [],
  bookmarks: [],
  watchlist: [],
  favorites: [],
  comments: [],
  reviews: [],
  announcements: [],
  schedule: [],
  khusus: [],
  notifications: [],
  settings: {},
  user_activities: [],
  maintenance: false,
  hiddenAnime: [],
  reports: [],
  chats: [],
  chatMessages: [],
};

function save() {
  try {
    const tempPath = DB_PATH + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(DB, null, 2));
    fs.renameSync(tempPath, DB_PATH);
  } catch (e) {
    console.error("Failed to save DB:", e);
  }
}
const BACKUP_DIR = path.join(DATA_DIR, "backups");
function backupDb() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, `db-${ts}.json`));
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("db-")).sort().reverse();
    if (files.length > 20) for (const f of files.slice(20)) fs.unlinkSync(path.join(BACKUP_DIR, f));
  } catch (e) { console.error("Backup failed:", e.message); }
}
function load() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
      if (parsed && typeof parsed === "object") DB = { ...DB, ...parsed };
    }
  } catch (e) {
    try {
      if (fs.existsSync(DB_PATH)) {
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, `db-corrupt-${ts}.json`));
      }
    } catch (e2) {}
    console.error("[db] db.json korup, backup disimpan:", e.message);
  }
}

function uid() { return "u_" + crypto.randomBytes(6).toString("hex"); }
function now() { return new Date().toISOString(); }

function ensureUser(userId) {
  if (!userId) return null;
  return DB.users.find(x => x.id === userId || x.uid === userId) || null;
}

load();

// Bersihkan user anonim tanpa email
const anonCount = DB.users.length;
DB.users = DB.users.filter(u => u.email);
if (DB.users.length < anonCount) { save(); console.log(`  Dibersihkan ${anonCount - DB.users.length} user anonim`); }

// ── Episode Lookup Cache ──────────────────────────────────────────
let episodeMap = new Map();  // key: "${animeId}:${epNumber}" → episode
function rebuildEpisodeMap() {
  episodeMap = new Map();
  for (const ep of DB.episodes) {
    const key = ep.anime_id + ":" + ep.number;
    episodeMap.set(key, ep);
  }
}
rebuildEpisodeMap();

// ── History Backfill Cache ────────────────────────────────────────
// Tracks which (userId, animeId) pairs have been checked for missing duration.
// Once checked and no episode duration available, skip on subsequent requests.
const backfillChecked = new Set();
function backfillKey(userId, animeId) { return userId + "::" + animeId; }

// ── Debounced Save ────────────────────────────────────────────────
let saveTimeout = null;
function debouncedSave(delay = 500) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => { saveTimeout = null; save(); }, delay);
}

// ── Helper ───────────────────────────────────────────────────────
function paginate(arr, page = 1, limit = 30) {
  const p = Math.max(1, parseInt(page));
  const l = Math.max(1, Math.min(100, parseInt(limit)));
  const start = (p - 1) * l;
  return { items: arr.slice(start, start + l), total: arr.length, page: p, totalPages: Math.ceil(arr.length / l) };
}

function normalizeEp(ep) {
  if (!ep) return ep;
  const links = ep.gdrive_links;
  if (typeof links === 'string') {
    try { ep = { ...ep, gdrive_links: JSON.parse(links) }; } catch { ep = { ...ep, gdrive_links: [] }; }
  }
  return ep;
}

function getAnimeFull(id) {
  const a = DB.anime.find(x => x.id === id);
  if (!a) return null;
  const eps = DB.episodes.filter(e => e.anime_id === id).sort((a, b) => a.number - b.number).map(normalizeEp);
  return { ...a, episodeList: eps };
}

function normalizeKhususId(id) {
  return String(id || '').replace(/^(?:khusus_)+/i, '');
}

function parseKhusus(k) {
  let gd = [];
  try { gd = typeof k.gdrive_links === 'string' ? JSON.parse(k.gdrive_links) : (k.gdrive_links || []); } catch { gd = []; }
  if (!Array.isArray(gd)) gd = [];
  gd = gd.map((l, i) => typeof l === 'string' ? { url: l, label: '1080p', episode: i + 1 } : { ...l, episode: l.episode != null ? Number(l.episode) : i + 1 }).sort((a, b) => (a.episode || 0) - (b.episode || 0));
  const episodeList = gd.map((l, i) => ({ number: l.episode || i + 1, title: 'Episode ' + (l.episode || i + 1), gdrive_links: [l] }));
  return { ...k, gdrive_links: gd, episodeList, episode_count: episodeList.length, khusus: true };
}

// ── Anime ────────────────────────────────────────────────────────
app.get("/api/anime", (req, res) => {
  try {
    let list = [...DB.anime];
    const { q, genre, status, sort, page, limit, khusus, aired_from, aired_to } = req.query;
    if (khusus === "true") list = list.filter(a => a.khusus === true);
    else if (khusus === "false") list = list.filter(a => !a.khusus);
    else list = list.filter(a => !a.khusus);
    if (q) { const s = q.toLowerCase(); list = list.filter(a => { const alt = Array.isArray(a.alt_titles) ? a.alt_titles.join(" ") : (a.alt_titles || ""); return a.title.toLowerCase().includes(s) || (a.title_jp || "").toLowerCase().includes(s) || String(alt).toLowerCase().includes(s); }); }
    if (genre) {
      const g = genre.toLowerCase();
      list = list.filter(a => {
        const gs = Array.isArray(a.genres) ? a.genres : (a.genre || "").split(", ").filter(Boolean);
        return gs.some(x => x.toLowerCase().includes(g));
      });
    }
    if (status) list = list.filter(a => a.status === status);
    if (req.query.hide) {
      const hideIds = req.query.hide.split(",").filter(Boolean);
      if (hideIds.length) list = list.filter(a => !hideIds.includes(a.id));
    }
    if (aired_from) list = list.filter(a => a.aired_from && String(a.aired_from).includes(aired_from));
    if (aired_to) list = list.filter(a => a.aired_to && String(a.aired_to).includes(aired_to));
    if (sort === "popular" || sort === "terpopuler") list.sort((a, b) => b.rating - a.rating);
    else if (sort === "oldest") list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else if (sort === "title" || sort === "az") list.sort((a, b) => a.title.localeCompare(b.title));
    else list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const p = paginate(list, page, limit);
    res.json({ animeList: p.items, total: p.total, page: p.page, totalPages: p.totalPages });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/anime/:id", (req, res) => {
  const a = getAnimeFull(req.params.id);
  if (a) return res.json(a);
  const k = DB.khusus.find(x => x.id === normalizeKhususId(req.params.id));
  if (!k) return res.status(404).json({ error: "Not found" });
  res.json(parseKhusus(k));
});

// ── Episodes ─────────────────────────────────────────────────────
app.get("/api/episodes/:animeId", (req, res) => {
  const eps = DB.episodes.filter(e => e.anime_id === req.params.animeId).sort((a, b) => a.number - b.number).map(normalizeEp);
  if (eps.length > 0) return res.json(eps);
  const k = DB.khusus.find(x => x.id === normalizeKhususId(req.params.animeId));
  if (k) return res.json(parseKhusus(k).episodeList);
  res.json([]);
});

// ── Random ───────────────────────────────────────────────────────
app.get("/api/random", (req, res) => {
  const { exclude } = req.query;
  let pool = DB.anime;
  if (exclude && pool.length > 1) pool = pool.filter(a => a.id !== exclude);
  const a = pool[Math.floor(Math.random() * pool.length)];
  res.json(a || { error: "No anime" });
});

// ── Ranking ──────────────────────────────────────────────────────
app.get("/api/ranking", (req, res) => {
  let list = [...DB.anime].sort((a, b) => b.rating - a.rating);
  const { limit } = req.query;
  if (limit) list = list.slice(0, parseInt(limit));
  res.json({ items: list });
});

// ── Trending Real ──────────────────────────────────────────────────
app.get("/api/trending-real", (req, res) => {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const counts = {};
  DB.history.forEach(h => {
    const ts = new Date(h.created_at || h.updated_at || 0).getTime();
    if (ts >= weekAgo) counts[h.anime_id] = (counts[h.anime_id] || 0) + 1;
  });
  const ranked = Object.entries(counts)
    .map(([aid, n]) => ({ anime: DB.anime.find(a => a.id === aid), watchCount: n }))
    .filter(x => x.anime)
    .sort((a, b) => b.watchCount - a.watchCount);
  const limit = parseInt(req.query.limit || "12");
  res.json({ items: ranked.slice(0, limit).map(x => ({ ...x.anime, _watchCount: x.watchCount })) });
});

// ── Genre Stats ──────────────────────────────────────────────────
app.get("/api/genres-stats", (req, res) => {
  const map = {};
  DB.anime.forEach(a => {
    const gs = a.genres || (a.genre || "").split(", ").filter(Boolean);
    gs.forEach(g => { map[g] = (map[g] || 0) + 1; });
  });
  res.json(Object.entries(map).map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count));
});

// ── Recommendations ──────────────────────────────────────────────
app.get("/api/recommendations", (req, res) => {
  let list = [...DB.anime].sort((a, b) => b.rating - a.rating);
  const { exclude, genres, limit } = req.query;
  if (exclude) { const ex = exclude.split(","); list = list.filter(a => !ex.includes(a.id)); }
  if (genres) { const gs = genres.toLowerCase().split(","); list = list.filter(a => { const ag = (a.genres || []).map(x => x.toLowerCase()); return gs.some(g => ag.includes(g)); }); }
  if (limit) list = list.slice(0, parseInt(limit));
  res.json({ items: list });
});

// ── Announcements ────────────────────────────────────────────────
app.get("/api/announcements", (req, res) => {
  res.json(DB.announcements.filter(a => a.active).slice(0, 5));
});

// ── Schedule ─────────────────────────────────────────────────────
app.get("/api/schedule", (req, res) => {
  const enriched = DB.schedule.map(s => {
    const anime = s.anime_id ? DB.anime.find(a => a.id === s.anime_id) : null;
    return { ...s, poster: anime?.poster || null, poster_url: anime?.poster || null };
  });
  res.json(enriched);
});

// ── History ──────────────────────────────────────────────────────
app.get("/api/history", (req, res) => {
  const { userId, animeId, limit } = req.query;
  if (!userId) return res.json([]);
  let h = DB.history.filter(x => x.user_id === userId).sort((a, b) => new Date(b.watched_at) - new Date(a.watched_at));
  if (animeId) h = h.filter(x => String(x.anime_id) === String(animeId));
  let needsSave = false;
  h = h.map(x => {
    if (!x.poster_url) {
      const a = DB.anime.find(an => an.id === x.anime_id);
      if (a && a.poster) x.poster_url = a.poster;
      if (a && !x.title) x.title = a.title || a.title_jp || "";
    }
    // Skip backfill if already checked (no episode data available)
    const bKey = backfillKey(x.user_id, x.anime_id);
    let resetDur = false;
    if (!x.duration_seconds || x.duration_seconds <= 0) {
      if (!backfillChecked.has(bKey)) resetDur = true;
    } else if (x.duration_seconds === 1440 || x.duration_seconds === Math.max(Math.round(x.progress_seconds * 2), 1440)) {
      resetDur = true;
    }
    if (resetDur) {
      let filled = 0;
      if (x.anime_id && x.episode) {
        const ep = episodeMap.get(x.anime_id + ":" + x.episode);
        if (ep && ep.duration > 0) filled = ep.duration;
      }
      x.duration_seconds = filled;
      const idx = DB.history.findIndex(h => h.user_id === x.user_id && h.anime_id === x.anime_id);
      if (idx >= 0) { DB.history[idx].duration_seconds = filled; }
      if (!filled) backfillChecked.add(bKey);
      else needsSave = true;
    } else if (x.duration_seconds > 0) {
      backfillChecked.add(bKey);
    }
    return x;
  });
  if (needsSave) save();
  if (animeId) return res.json(req.query.all ? h : (h[0] || null));
    const seen = new Map();
  for (const x of h) { const k = String(x.anime_id); const cur = seen.get(k); if (!cur || new Date(x.watched_at) > new Date(cur.watched_at)) seen.set(k, x); }
  const deduped = [...seen.values()].sort((p, q) => new Date(q.watched_at) - new Date(p.watched_at));
  return res.json(limit ? deduped.slice(0, parseInt(limit)) : deduped);
});

app.post("/api/history", (req, res) => {
  const { userId, anime_id, animeId, title, poster, posterUrl, episode, progress_seconds, progressSeconds, duration_seconds, durationSeconds } = req.body;
  const aid = anime_id || animeId;
  if (!userId || !aid) return res.status(400).json({ error: "userId and animeId required" });
  if (!rateLimit("hist:" + userId, 30)) return res.status(429).json({ error: "Too many requests" });
  ensureUser(userId);
  const ep = String(episode || "");
  const idx = DB.history.findIndex(h => String(h.user_id) === String(userId) && String(h.anime_id) === String(aid) && String(h.episode) === String(ep));
  const entry = { user_id: userId, anime_id: aid, title: title || "", poster_url: poster || posterUrl || "", episode: ep, progress_seconds: progress_seconds || progressSeconds || 0, duration_seconds: duration_seconds || durationSeconds || 0, watched_at: now() };
  if (idx >= 0) {
    const old = DB.history[idx];
    const merged = { ...old, ...entry, id: old.id };
    if (!entry.duration_seconds && old.duration_seconds) merged.duration_seconds = old.duration_seconds;
    DB.history[idx] = merged;
  }
  else { entry.id = DB.history.length + 1; DB.history.push(entry); }
  save();
  logActivity(userId, "watch:" + aid, req);
  res.json({ statusCode: 200, message: "Saved" });
});

app.delete("/api/history/:userId/:animeId", (req, res) => {
  if (req.params.animeId === "clear") {
    DB.history = DB.history.filter(h => h.user_id !== req.params.userId);
    save();
    return res.json({ statusCode: 200, message: "Cleared" });
  }
  DB.history = DB.history.filter(h => !(String(h.user_id) === String(req.params.userId) && String(h.anime_id) === String(req.params.animeId)));
  save();
  res.json({ statusCode: 200, message: "Deleted" });
});

// ── Watchlist ────────────────────────────────────────────────────
app.get("/api/watchlist/:userId", (req, res) => {
  const items = DB.watchlist.filter(w => w.user_id === req.params.userId).map(w => {
    const a = DB.anime.find(x => x.id === w.anime_id);
    return { ...w, anime: a || { id: w.anime_id, title: w.title || "Unknown" } };
  });
  res.json({ items });
});

app.post("/api/watchlist/:userId/:animeId", (req, res) => {
  const { userId, animeId } = req.params;
  const { status } = req.body;
  ensureUser(userId);
  if (status === "remove") {
    DB.watchlist = DB.watchlist.filter(w => !(w.user_id === userId && w.anime_id === animeId));
  } else {
    const idx = DB.watchlist.findIndex(w => w.user_id === userId && w.anime_id === animeId);
    const a = DB.anime.find(x => x.id === animeId);
    const entry = { user_id: userId, anime_id: animeId, title: a?.title || "", poster: a?.poster || "", status: status || "plan_to_watch", added_at: now() };
    if (idx >= 0) DB.watchlist[idx] = { ...DB.watchlist[idx], ...entry, id: DB.watchlist[idx].id };
    else { entry.id = DB.watchlist.length + 1; DB.watchlist.push(entry); }
  }
  save();
  res.json({ statusCode: 200, message: "Saved" });
});

app.get("/api/watchlist/:userId/:animeId", (req, res) => {
  const w = DB.watchlist.find(x => x.user_id === req.params.userId && x.anime_id === req.params.animeId);
  res.json(w || null);
});

// ── Bookmarks ────────────────────────────────────────────────────
app.get("/api/bookmarks/:userId", (req, res) => {
  const items = DB.bookmarks.filter(b => b.user_id === req.params.userId).map(b => {
    const a = DB.anime.find(x => x.id === b.anime_id);
    return { ...b, anime: a || null };
  });
  res.json(items);
});

app.delete("/api/bookmarks/:userId/:animeId", (req, res) => {
  DB.bookmarks = DB.bookmarks.filter(b => !(b.user_id === req.params.userId && b.anime_id === req.params.animeId));
  save();
  res.json({ statusCode: 200, message: "Deleted" });
});

app.post("/api/bookmarks", (req, res) => {
  const { userId, animeId, title, poster } = req.body;
  if (!userId || !animeId) return res.status(400).json({ error: "userId and animeId required" });
  ensureUser(userId);
  const existing = DB.bookmarks.find(b => b.user_id === userId && b.anime_id === animeId);
  if (existing) {
    DB.bookmarks = DB.bookmarks.filter(b => !(b.user_id === userId && b.anime_id === animeId));
    save();
    return res.json({ statusCode: 200, message: "Removed", bookmarked: false });
  } else {
    DB.bookmarks.push({ user_id: userId, anime_id: animeId, title: title || "", poster: poster || "", added_at: now() });
    save();
    return res.json({ statusCode: 200, message: "Added", bookmarked: true });
  }
});

// ── Favorites ────────────────────────────────────────────────────
app.get("/api/favorites/:userId", (req, res) => {
  const items = DB.favorites.filter(f => f.user_id === req.params.userId).map(f => {
    const a = DB.anime.find(x => x.id === f.anime_id);
    return { ...f, anime: a || { id: f.anime_id, title: f.title || "Unknown" } };
  });
  res.json(items);
});

app.get("/api/favorites/:userId/:animeId", (req, res) => {
  const f = DB.favorites.find(x => x.user_id === req.params.userId && x.anime_id === req.params.animeId);
  res.json(f || null);
});

app.post("/api/favorites/:userId/:animeId", (req, res) => {
  const { userId, animeId } = req.params;
  if (!DB.favorites.find(f => f.user_id === userId && f.anime_id === animeId)) {
    const a = DB.anime.find(x => x.id === animeId);
    DB.favorites.push({ user_id: userId, anime_id: animeId, title: a?.title || "", poster: a?.poster || "", added_at: now() });
    save();
  }
  res.json({ statusCode: 200, message: "Favorited" });
});

app.delete("/api/favorites/:userId/:animeId", (req, res) => {
  DB.favorites = DB.favorites.filter(f => !(f.user_id === req.params.userId && f.anime_id === req.params.animeId));
  save();
  res.json({ statusCode: 200, message: "Removed" });
});

// ── Comments ─────────────────────────────────────────────────────
app.get("/api/comments", (req, res) => {
  const { animeId } = req.query;
  let list = animeId ? DB.comments.filter(c => c.anime_id === animeId) : DB.comments;
  res.json(list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.post("/api/comments", (req, res) => {
  if (!rateLimit('cmt:' + req.ip, 30)) return res.status(429).json({ error: 'Terlalu banyak komentar. Coba lagi nanti.' });
  const { animeId, userId, text, author } = req.body;
  if (!animeId || !text) return res.status(400).json({ error: "animeId and text required" });
  ensureUser(userId);
  const c = { id: DB.comments.length + 1, anime_id: animeId, user_id: userId || "anon", author: author || "", text, created_at: now() };
  DB.comments.push(c);
  save();
  res.json(c);
});

app.delete("/api/comments/:id", (req, res) => {
  DB.comments = DB.comments.filter(c => c.id !== parseInt(req.params.id));
  save();
  res.json({ statusCode: 200, message: "Deleted" });
});

// ── Reviews ──────────────────────────────────────────────────────
app.get("/api/reviews", (req, res) => {
  const { animeId } = req.query;
  let list = animeId ? DB.reviews.filter(r => r.anime_id === animeId) : DB.reviews;
  res.json(list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.post("/api/reviews", (req, res) => {
  if (!rateLimit('rev:' + req.ip, 20)) return res.status(429).json({ error: 'Terlalu banyak review. Coba lagi nanti.' });
  const { animeId, userId, rating, text, author } = req.body;
  if (!animeId || !rating) return res.status(400).json({ error: "animeId and rating required" });
  ensureUser(userId);
  const r = {
    id: DB.reviews.length + 1, anime_id: animeId, user_id: userId || "anon",
    author: author || "", text: text || "", rating: Math.min(10, Math.max(1, parseFloat(rating))),
    created_at: now(),
  };
  DB.reviews.push(r);
  save();
  res.json(r);
});

app.delete("/api/reviews", (req, res) => {
  const { userId, animeId } = req.query;
  if (userId && animeId) {
    DB.reviews = DB.reviews.filter(r => !(r.user_id === userId && r.anime_id === animeId));
  } else if (req.body?.userId && req.body?.animeId) {
    DB.reviews = DB.reviews.filter(r => !(r.user_id === req.body.userId && r.anime_id === req.body.animeId));
  } else {
    return res.status(400).json({ error: "userId and animeId required" });
  }
  save();
  res.json({ statusCode: 200, message: "Deleted" });
});

// ── Requests ─────────────────────────────────────────────────────
app.get("/api/requests", (req, res) => {
  const { userId } = req.query;
  let list = userId ? DB.requests.filter(r => r.user_id === userId) : DB.requests;
  const enriched = list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(r => {
    let u = DB.users.find(x => x.id === r.user_id || x.uid === r.user_id);
    if (!u) { ensureUser(r.user_id); u = DB.users.find(x => x.id === r.user_id || x.uid === r.user_id); }
    return { ...r, user_name: (u?.display_name && u.display_name !== 'Penonton') ? u.display_name : (u?.username || r.user_id), user_email: u?.email || '' };
  });
  res.json(enriched);
});

app.post("/api/requests", (req, res) => {
  const { title, notes, userId } = req.body;
  if (!title) return res.status(400).json({ error: "Title required" });
  if (!rateLimit("req:" + userId, 10)) return res.status(429).json({ error: "Too many requests" });
  ensureUser(userId);
  DB.requests.push({ id: DB.requests.length + 1, title: sanitize(title), notes: sanitize(notes || ""), user_id: userId || "anon", status: "pending", created_at: now() });
  save();
  res.json({ statusCode: 200, message: "Request submitted" });
});

// ── Hidden Anime ───────────────────────────────────────────────────
app.get("/api/hidden", (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.json([]);
  const hidden = (DB.hiddenAnime || []).filter(h => h.user_id === userId).map(h => h.anime_id);
  res.json(hidden);
});

app.post("/api/hidden", (req, res) => {
  const { userId, animeId } = req.body;
  if (!userId || !animeId) return res.status(400).json({ error: "userId and animeId required" });
  if (!DB.hiddenAnime) DB.hiddenAnime = [];
  if (!DB.hiddenAnime.find(h => h.user_id === userId && h.anime_id === animeId)) {
    DB.hiddenAnime.push({ user_id: userId, anime_id: animeId, created_at: now() });
    save();
  }
  res.json({ statusCode: 200, message: "Hidden" });
});

app.delete("/api/hidden/:animeId", (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: "userId required" });
  DB.hiddenAnime = (DB.hiddenAnime || []).filter(h => !(h.user_id === userId && h.anime_id === req.params.animeId));
  save();
  res.json({ statusCode: 200, message: "Unhidden" });
});

// ── Reports ──────────────────────────────────────────────────────
app.get("/api/reports", (req, res) => {
  const { userId } = req.query;
  let list = userId ? (DB.reports || []).filter(r => r.user_id === userId) : (DB.reports || []);
  res.json(list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.post("/api/reports", (req, res) => {
  const { anime_id, episode, userId, title, description } = req.body;
  if (!anime_id || !title) return res.status(400).json({ error: "anime_id and title required" });
  if (!rateLimit("report:" + userId, 10)) return res.status(429).json({ error: "Too many requests" });
  ensureUser(userId);
  if (!DB.reports) DB.reports = [];
  DB.reports.push({
    id: DB.reports.length + 1,
    anime_id,
    episode: episode || "",
    user_id: userId || "anon",
    title: sanitize(title),
    description: sanitize(description || ""),
    status: "pending",
    created_at: now()
  });
  save();
  res.json({ statusCode: 200, message: "Report submitted" });
});

app.get("/api/admin/reports", (req, res) => {
  if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
  res.json([...(DB.reports || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.put("/api/admin/reports/:id", (req, res) => {
  if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
  const r = (DB.reports || []).find(x => x.id === parseInt(req.params.id));
  if (r) r.status = req.body.status || r.status;
  save();
  res.json({ statusCode: 200, message: "Updated" });
});

// ── Chat Ticket System ─────────────────────────────────────────────
app.get("/api/chat/list", (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.json([]);
  const list = (DB.chats || []).filter(c => c.user_id === userId);
  res.json(list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.post("/api/chat/create", (req, res) => {
  const { userId, subject } = req.body;
  if (!userId || !subject) return res.status(400).json({ error: "userId and subject required" });
  if (!rateLimit("chat:" + userId, 5)) return res.status(429).json({ error: "Too many requests" });
  ensureUser(userId);
  if (!DB.chats) DB.chats = [];
  const chat = {
    id: (DB.chats.length || 0) + 1,
    user_id: userId,
    subject: sanitize(subject),
    status: "open",
    created_at: now(),
    closed_at: null
  };
  DB.chats.push(chat);
  save();
  // Auto-add first message
  if (!DB.chatMessages) DB.chatMessages = [];
  DB.chatMessages.push({
    id: Date.now() + Math.random(),
    chat_id: chat.id,
    sender: "user",
    text: sanitize(subject),
    created_at: now()
  });
  save();
  // Notify admin about new ticket
  io.to("admin").emit("chat:newTicket", { chatId: chat.id, userId, subject: subject.trim() });
  res.json(chat);
});

app.get("/api/chat/:id/messages", (req, res) => {
  const chatId = parseInt(req.params.id);
  const chat = (DB.chats || []).find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  // Allow owner or admin
  const userId = req.query.userId || req.user?.id;
  const isAdmin = safeEq(req.headers["x-admin-key"], ADMIN_PW) || (req.user && (req.user.role === 'dev' || req.user.role === 'admin'));
  if (!isAdmin && chat.user_id !== userId) return res.status(403).json({ error: "Unauthorized" });
  const msgs = (DB.chatMessages || []).filter(m => m.chat_id === chatId);
  res.json(msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
});

app.post("/api/chat/:id/message", (req, res) => {
  const chatId = parseInt(req.params.id);
  const { userId, text, sender } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });
  const chat = (DB.chats || []).find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  if (chat.status === "closed") return res.status(400).json({ error: "Chat is closed" });
  if (!DB.chatMessages) DB.chatMessages = [];
  const msg = {
    id: Date.now() + Math.random(),
    chat_id: chatId,
    sender: sender || "user",
    text: text.trim(),
    created_at: now()
  };
  DB.chatMessages.push(msg);
  save();
  io.to(`chat:${chatId}`).emit("chat:message", msg);
  if (sender !== "admin") io.to("admin").emit("chat:newTicket", { chatId, userId: chat.user_id, text: text.trim(), subject: chat.subject });
  if (sender === "admin") io.to(`user:${chat.user_id}`).emit("chat:notify", { chatId, text: text.trim(), subject: chat.subject });
  res.json(msg);
});

app.put("/api/chat/:id/close", (req, res) => {
  const chatId = parseInt(req.params.id);
  const chat = (DB.chats || []).find(c => c.id === chatId);
  if (chat) {
    chat.status = "closed";
    chat.closed_at = now();
    save();
    io.to(`chat:${chatId}`).emit("chat:closed", { chatId });
  }
  res.json({ statusCode: 200, message: "Closed" });
});

// Admin endpoints
app.get("/api/admin/chat/list", (req, res) => {
  if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
  const chats = (DB.chats || []).filter(c => c.status === "open");
  const messages = DB.chatMessages || [];
  const msgMap = {}, countMap = {};
  for (const m of messages) {
    if (!msgMap[m.chat_id] || new Date(m.created_at) > new Date(msgMap[m.chat_id].created_at)) {
      msgMap[m.chat_id] = m;
    }
    countMap[m.chat_id] = (countMap[m.chat_id] || 0) + 1;
  }
  const result = chats.map(c => ({
    ...c, lastMessage: msgMap[c.id] || null, messageCount: countMap[c.id] || 0
  }));
  res.json(result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.put("/api/admin/chat/:id/close", (req, res) => {
  if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
  const chatId = parseInt(req.params.id);
  const chat = (DB.chats || []).find(c => c.id === chatId);
  if (chat) {
    chat.status = "closed";
    chat.closed_at = now();
    io.to(`chat:${chatId}`).emit("chat:closed", { chatId });
    save();
  }
  res.json({ statusCode: 200, message: "Closed" });
});

app.post("/api/admin/chat/:id/close", (req, res) => {
  if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
  const chatId = parseInt(req.params.id);
  const chat = (DB.chats || []).find(c => c.id === chatId);
  if (chat) {
    chat.status = "closed";
    chat.closed_at = now();
    io.to(`chat:${chatId}`).emit("chat:closed", { chatId });
    save();
  }
  res.json({ statusCode: 200, message: "Closed" });
});

// ── Socket.IO Chat ──────────────────────────────────────────────
io.on("connection", (socket) => {
  const userId = socket.handshake.query.userId;
  console.log(`[SOCKET] User ${userId || '?'} connected (total: ${io.engine?.clientsCount || '?'})`);
  if (!userId) return socket.disconnect();

  // Join personal room
  socket.join(`user:${userId}`);

  // If admin, join admin room — verify from DB, not client
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  let isAdmin = false;
  if (token) {
    const dbUser = DB.users.find(u => u.token === token);
    if (dbUser && (dbUser.role === 'admin' || dbUser.role === 'dev')) isAdmin = true;
  }
  if (isAdmin) socket.join("admin");

  // Join a specific chat room
  socket.on("chat:join", (chatId) => {
    socket.join(`chat:${chatId}`);
  });

  socket.on("chat:leave", (chatId) => {
    socket.leave(`chat:${chatId}`);
  });

  // Send message to a chat
  socket.on("chat:send", (data) => {
    const { chatId, text, sender } = data;
    if (!chatId || !text) return;
    const chat = (DB.chats || []).find(c => c.id === chatId);
    if (!chat || chat.status === "closed") return;

    if (!DB.chatMessages) DB.chatMessages = [];
    const msg = {
      id: Date.now() + Math.random(),
      chat_id: chatId,
      sender: sender || "user",
      text: text.trim(),
      created_at: new Date().toISOString()
    };
    msg.text = sanitize(msg.text);
    DB.chatMessages.push(msg);
    debouncedSave();

    // Broadcast to the chat room (everyone in that chat)
    io.to(`chat:${chatId}`).emit("chat:message", msg);

    // Notify all connected clients about new ticket activity
    if (sender !== "admin") {
      io.to("admin").emit("chat:newTicket", { chatId, userId: chat.user_id, text: text.trim(), subject: chat.subject });
    }

    // Notify user room if admin sends a reply
    if (sender === "admin") {
      io.to(`user:${chat.user_id}`).emit("chat:notify", { chatId, text: text.trim(), subject: chat.subject });
    }
  });

  // Admin: close chat
  socket.on("chat:close", (chatId) => {
    const chat = (DB.chats || []).find(c => c.id === chatId);
    if (chat) {
      chat.status = "closed";
      chat.closed_at = new Date().toISOString();
      save();
      io.to(`chat:${chatId}`).emit("chat:closed", { chatId });
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(`[SOCKET] User ${userId || '?'} disconnected: ${reason}`);
  });
});

// ── Khusus ───────────────────────────────────────────────────────
app.get("/api/khusus/:id", (req, res) => {
  const k = DB.khusus.find(x => x.id === normalizeKhususId(req.params.id));
  if (!k) return res.status(404).json({ error: "Not found" });
  res.json(parseKhusus(k));
});

app.get("/api/khusus", (req, res) => {
  try {
    const items = DB.khusus.map(k => {
      const item = { ...k };
      let links = item.gdrive_links || item.gdrive_link || [];
      if (typeof links === 'string') { try { links = JSON.parse(links); } catch { links = []; } }
      if (!Array.isArray(links)) links = [];
    links = links.map((l, i) => typeof l === 'string' ? { url: l, label: '1080p', episode: i + 1 } : { ...l, episode: l.episode != null ? Number(l.episode) : i + 1 }).sort((a, b) => (a.episode || 0) - (b.episode || 0));
      if (!links.length && Array.isArray(item.episodes)) {
        links = item.episodes.map(ep => {
          let el = [];
          try {
            el = typeof ep.gdrive_links === 'string' ? JSON.parse(ep.gdrive_links) : (ep.gdrive_links || []);
          } catch {
            el = [];
          }
          const first = Array.isArray(el) ? el[0] : {};
          return { episode: ep.number || 1, url: first.url || '', label: first.label || '1080p' };
        });
      }
      item.gdrive_links = links;
      delete item.gdrive_link;
      return item;
    });
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ── Profile ────────────────────────────────────────────────────────
app.get("/api/user/profile", (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId required" });
    let u = DB.users.find(x => x.id === userId || x.uid === userId);
    if (!u) return res.json({ display_name: "Penonton", bio: "", picture: "" });
    const total_watch_seconds = u.total_watch_seconds || 0;
    res.json({ display_name: u.display_name || u.username || "Penonton", bio: u.bio || "", picture: u.picture || u.avatar || "", total_watch_seconds, username: u.username });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/user/profile", (req, res) => {
  try {
    const { userId, display_name, bio, picture } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    let u = DB.users.find(x => x.id === userId || x.uid === userId);
    if (!u) {
      u = { id: userId, uid: userId, username: "user_" + userId.slice(2, 6), display_name: "Penonton", created_at: now() };
      DB.users.push(u);
    }
    if (display_name !== undefined) u.display_name = display_name;
    if (bio !== undefined) u.bio = bio;
    if (picture !== undefined) u.picture = picture;
    save();
    res.json({ message: "Profile updated", profile: { display_name: u.display_name, bio: u.bio, picture: u.picture, username: u.username, total_watch_seconds: u.total_watch_seconds || 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/user/password", (req, res) => {
  try {
    const token = req.headers["x-auth-token"];
    const { oldPassword, newPassword } = req.body;
    if (!token) return res.status(401).json({ error: "Login diperlukan" });
    if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: "Password baru minimal 4 karakter" });
    const user = DB.users.find(u => u.token === token);
    if (!user) return res.status(401).json({ error: "Token tidak valid" });
    if (user.hash) {
      const oldHash = crypto.createHash("sha256").update((oldPassword || '') + user.salt).digest("hex");
      if (oldHash !== user.hash) return res.status(400).json({ error: "Password lama salah" });
    }
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.createHash("sha256").update(newPassword + salt).digest("hex");
    user.salt = salt;
    user.hash = hash;
    save();
    res.json({ message: "Password berhasil diubah" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/user/watch-time", (req, res) => {
  try {
    const { userId, seconds } = req.body;
    if (!userId || !seconds) return res.status(400).json({ error: "userId dan seconds wajib" });
    let u = DB.users.find(x => x.id === userId || x.uid === userId);
    if (!u) {
      u = { id: userId, uid: userId, username: "user_" + userId.slice(2, 6), display_name: "Penonton", created_at: now() };
      DB.users.push(u);
    }
    u.total_watch_seconds = (u.total_watch_seconds || 0) + parseInt(seconds);
    save();
    logActivity(u.id, "watch_time:" + seconds, req);
    res.json({ total_watch_seconds: u.total_watch_seconds });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ── User Stats (Admin) ────────────────────────────────────────────
app.get("/api/admin/user-stats", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || req.user.role !== 'dev')) return res.status(403).json({ error: "Unauthorized" });
    const totalUsers = DB.users.length;
    const totalHistory = DB.history.length;
    const activities = (DB.user_activities || []).slice(-100);
    const users = DB.users.filter(u => u.email).map(u => {
      const uid = u.id;
      const ua = (DB.user_activities || []).filter(a => a.user_id === uid);
      const hist = DB.history.filter(h => h.user_id === uid);
      const lastUa = ua.length ? ua[ua.length - 1] : null;
      const lastHist = hist.length ? hist[hist.length - 1] : null;
      const lastTsUa = lastUa ? new Date(lastUa.created_at).getTime() : 0;
      const lastTsHist = lastHist ? new Date(lastHist.watched_at).getTime() : 0;
      const last = lastTsUa > lastTsHist ? lastUa : lastHist;
      const lastTs = last ? (last.created_at ? new Date(last.created_at).getTime() : new Date(last.watched_at).getTime()) : 0;
      const distinctAnime = new Set(hist.map(h => h.anime_id)).size;
      const watchActs = ua.filter(a => a.action && a.action.startsWith("watch:"));
      const recentWatchActs = watchActs.filter(a => Date.now() - new Date(a.created_at).getTime() < 30 * 60 * 1000);
      const watchingAct = recentWatchActs.length ? recentWatchActs[recentWatchActs.length - 1] : null;
      let watching = "";
      if (watchingAct) {
        const aid = watchingAct.action.split(":")[1];
        const aTitle = DB.anime.find(a => a.id === aid);
        watching = aTitle ? (aTitle.title || aTitle.title_jp || aid) : aid;
      } else if (lastHist && Date.now() - lastTsHist < 30 * 60 * 1000) {
        const aTitle = DB.anime.find(a => a.id === lastHist.anime_id);
        watching = aTitle ? (aTitle.title || aTitle.title_jp || lastHist.anime_id) : lastHist.anime_id;
      }
      const finished = hist.filter(h => h.duration_seconds > 0 && h.progress_seconds / h.duration_seconds >= 0.9)
        .map(h => { const a = DB.anime.find(x => x.id === h.anime_id); return a ? (a.title || a.title_jp || h.anime_id) : h.anime_id; });
      const online = lastTs ? (Date.now() - lastTs < 30 * 60 * 1000) : false;
      return {
        id: u.id,
        username: u.username,
        display_name: u.display_name || u.username,
        picture: u.picture || u.avatar || "",
        email: u.email || "",
        role: u.role || "user",
        total_watch_seconds: Math.round(hist.reduce((s,h) => s + (h.progress_seconds||0), 0)),
        total_minutes: Math.round(hist.reduce((s,h) => s + (h.progress_seconds||0), 0) / 60),
        total_anime: distinctAnime,
        history_count: hist.length,
        online,
        watching,
        finished: finished.slice(-10),
        created_at: u.created_at,
        last_ip: last ? last.ip : "",
        last_device: last ? last.device : "",
        last_activity: last ? last.created_at : ""
      };
    });
    res.json({ totalUsers, totalHistory, users, recentActivities: activities.reverse() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/set-role", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || req.user.role !== 'dev')) return res.status(403).json({ error: "Unauthorized" });
    const { userId, role } = req.body;
    if (!userId || !role) return res.status(400).json({ error: "userId dan role wajib" });
    const user = DB.users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: "User tidak ditemukan" });
    if (role === 'dev') return res.status(400).json({ error: "Hanya pemilik yg bisa jadi dev" });
    user.role = role;
    save();
    res.json({ message: "Role updated", user: { id: user.id, username: user.username, role: user.role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/admin/khusus-config", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || req.user.role !== 'dev')) return res.status(403).json({ error: "Unauthorized" });
    res.json({ password: DB.khusus_password || "animebokep" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/khusus-config", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || req.user.role !== 'dev')) return res.status(403).json({ error: "Unauthorized" });
    const { password } = req.body;
    if (!password || password.length < 3) return res.status(400).json({ error: "Password minimal 3 karakter" });
    DB.khusus_password = password;
    save();
    res.json({ message: "Password khusus diupdate" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/khusus", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || req.user.role !== 'dev')) return res.status(403).json({ error: "Unauthorized" });
    const { id, title, poster, gdrive_links, description, synopsis } = req.body;
    if (!title || !String(title).trim()) return res.status(400).json({ error: "title wajib diisi" });
    let links = gdrive_links;
    if (typeof links === 'string') { try { links = JSON.parse(links); } catch { links = []; } }
    if (!Array.isArray(links)) links = [];
    links = links.map((l, i) => typeof l === 'string' ? { url: l, label: '1080p', episode: i + 1 } : { ...l, episode: l.episode != null ? Number(l.episode) : i + 1 }).sort((a, b) => (a.episode || 0) - (b.episode || 0));
    const desc = description || synopsis || "";
    const idx = id != null && id !== '' ? DB.khusus.findIndex(k => String(k.id) === String(id)) : -1;
    if (idx >= 0) {
      DB.khusus[idx] = { ...DB.khusus[idx], title, poster: poster || DB.khusus[idx].poster || "", gdrive_links: links, description: desc };
      save();
      return res.json({ message: "Konten khusus diupdate", id: DB.khusus[idx].id });
    }
    const newId = id || ('khusus-' + Date.now());
    DB.khusus.push({ id: newId, title, poster: poster || "", gdrive_links: links, description: desc });
    save();
    res.json({ message: "Konten khusus ditambahkan", id: newId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/admin/khusus/:id", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || req.user.role !== 'dev')) return res.status(403).json({ error: "Unauthorized" });
    const before = DB.khusus.length;
    DB.khusus = DB.khusus.filter(k => String(k.id) !== String(req.params.id));
    if (DB.khusus.length === before) return res.status(404).json({ error: "Konten tidak ditemukan" });
    save();
    res.json({ message: "Konten khusus dihapus" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/admin/stats", (req, res) => {
  if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
  res.json({
    animeCount: DB.anime.length,
    episodeCount: DB.episodes.length,
    requestCount: DB.requests.length,
    pendingRequests: DB.requests.filter(r => r.status === "pending").length,
    khususCount: DB.khusus.length,
  });
});

function toDirectGDrive(url) {
  if (!url || typeof url !== "string") return url;
  
  // Telegram extraction
  const tlMatch = url.match(/(?:t\.me|telegram\.me)\/(c\/)?([a-zA-Z0-9_-]+)\/(\d+)/);
  if (tlMatch) {
    const isPrivate = tlMatch[1];
    const channelName = isPrivate ? "-100" + tlMatch[2] : tlMatch[2];
    const messageId = tlMatch[3];
    return `/api/telegram/${channelName}/${messageId}`;
  }

  const id = extractGDriveId(url);
  if (!id) return url;
  return `/api/gdrive/${id}`;
}

function extractGDriveId(url) {
  const m = url.match(/(?:drive\.google\.com|docs\.google\.com)\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2 && url.includes("drive.google.com")) return m2[1];
  const m3 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m3) return m3[1];
  return null;
}

// ── Admin CRUD ───────────────────────────────────────────────────
app.get("/api/admin/maintenance", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    const m = readMaintenance();
    res.json({ maintenance: m.active || DB.maintenance });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/maintenance", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    const active = req.body.maintenance === true || req.body.maintenance === "true";
    DB.maintenance = active;
    save();
    fs.writeFileSync(MAINTENANCE_FILE, JSON.stringify({
      active,
      message: req.body.message || "MahiStream sedang dalam pemeliharaan. Kami akan kembali segera!" }, null, 2));
    res.json({ statusCode: 200, message: active ? "Maintenance diaktifkan" : "Maintenance dinonaktifkan", maintenance: active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/anime", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    const { id, title, title_jp, alt_titles, poster, synopsis, genre, status, rating, aired_from, aired_to, type, gdrive_links } = req.body;
    if (!title) return res.status(400).json({ error: "Judul wajib" });
    let slug = id || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    let idx = DB.anime.findIndex(a => a.id === slug);
    if (idx >= 0 && !id && DB.anime[idx].title.toLowerCase() !== title.toLowerCase()) {
      let n = 2;
      while (idx >= 0) { slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + n; idx = DB.anime.findIndex(a => a.id === slug); n++; }
    }
    const oldCount = idx >= 0 ? (DB.anime[idx].episode_count || 0) : 0;
    const oldPoster = idx >= 0 ? (DB.anime[idx].poster || "") : "";
    const entry = { id: slug, title, title_jp: title_jp || "", alt_titles: alt_titles || "", poster: poster || oldPoster, synopsis: synopsis || "", genre: genre || "", genres: (genre || "").split(", ").filter(Boolean), status: status || "ongoing", rating: rating || 0, aired_from: aired_from || null, aired_to: aired_to || null, type: type || "TV", episode_count: oldCount, created_at: idx >= 0 ? DB.anime[idx].created_at : now() };
    if (idx >= 0) DB.anime[idx] = { ...DB.anime[idx], ...entry };
    else DB.anime.push(entry);
    if (gdrive_links && typeof gdrive_links === "string" && gdrive_links.trim()) {
      const lines = gdrive_links.split("\n").map(s => s.trim()).filter(Boolean);
      const episodesByNum = {};
      const skipMap = {};
      const parseTime = (str) => {
        const parts = str.split(':');
        if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1]);
        return parseInt(str) || 0;
      };
      for (const line of lines) {
        const skipMatch = line.match(/^SKIP:(\d+)\|(.+)/);
        if (skipMatch) {
          const val = skipMatch[2].trim();
          const rangeMatch = val.match(/(\d+:\d+)-(\d+:\d+)/);
          if (rangeMatch) skipMap[parseInt(skipMatch[1])] = parseTime(rangeMatch[2]);
          else skipMap[parseInt(skipMatch[1])] = parseTime(val);
          continue;
        }
        const parts = line.split("|").map(s => s.trim());
        const epNum = parseInt(parts[0]);
        if (!epNum) continue;
        let label = "";
        let url = "";
        if (parts.length === 2) { url = parts[1]; }
        else if (parts.length >= 3) { label = parts[1]; url = parts.slice(2).join("|"); }
        if (!url) continue;
        if (!episodesByNum[epNum]) episodesByNum[epNum] = [];
        episodesByNum[epNum].push({ url: toDirectGDrive(url), label });
      }
      let epCount = 0;
      for (const [epNum, urls] of Object.entries(episodesByNum)) {
        const n = parseInt(epNum);
        const linksArr = urls.map((item, i) => ({ url: item.url, label: item.label || `${1080 - i * 360}p` }));
        const epIdx = DB.episodes.findIndex(e => e.anime_id === slug && e.number === n);
        const existingSkip = epIdx >= 0 ? (DB.episodes[epIdx]?.skip_intro || 0) : 0;
        const epEntry = { anime_id: slug, number: n, title: `Episode ${n}`, gdrive_links: JSON.stringify(linksArr), duration: 0, skip_intro: skipMap[n] !== undefined ? skipMap[n] : existingSkip, id: DB.episodes.length + 1 + epCount };
        if (epIdx >= 0) DB.episodes[epIdx] = { ...DB.episodes[epIdx], ...epEntry };
        else DB.episodes.push(epEntry);
        epCount++;
      }
      if (epCount > 0) {
        entry.episode_count = epCount;
        const aIdx = DB.anime.findIndex(a => a.id === slug);
        if (aIdx >= 0) DB.anime[aIdx].episode_count = epCount;
      }
    }
    save();
    backupDb();
    rebuildEpisodeMap();
    res.json({ statusCode: 200, message: "Anime saved", id: slug });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

app.delete("/api/admin/anime/:id", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    DB.anime = DB.anime.filter(a => a.id !== req.params.id);
    DB.episodes = DB.episodes.filter(e => e.anime_id !== req.params.id);
    save();
    backupDb();
    rebuildEpisodeMap();
    res.json({ statusCode: 200, message: "Deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/episodes", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    let { anime_id, number, title, gdrive_links, duration, skip_intro } = req.body;
    if (!anime_id || number === undefined) return res.status(400).json({ error: "anime_id dan number wajib" });
    number = parseInt(number);
    let links = gdrive_links || "[]";
    if (typeof links === "string") {
      try { const arr = JSON.parse(links); if (Array.isArray(arr)) { links = JSON.stringify(arr.map(l => ({ ...l, url: toDirectGDrive(l.url || "") }))); } } catch {}
    } else {
      links = JSON.stringify((links || []).map(l => ({ ...l, url: toDirectGDrive(l.url || "") })));
    }
    const idx = DB.episodes.findIndex(e => e.anime_id === anime_id && e.number === number);
    const entry = { anime_id, number, title: title || "", gdrive_links: links, duration: duration || 0, skip_intro: skip_intro || 0 };
    if (idx >= 0) DB.episodes[idx] = { ...DB.episodes[idx], ...entry, id: DB.episodes[idx].id };
    else { entry.id = (DB.episodes.reduce((m, e) => Math.max(m, e.id || 0), 0)) + 1; DB.episodes.push(entry); }
    const aIdx = DB.anime.findIndex(a => a.id === anime_id);
    if (aIdx >= 0) DB.anime[aIdx].episode_count = DB.episodes.filter(e => e.anime_id === anime_id).length;
    save();
    backupDb();
    rebuildEpisodeMap();
    res.json({ statusCode: 200, message: "Episode saved" });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

app.delete("/api/admin/episodes/:id", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    const delIdx = DB.episodes.findIndex(e => e.id === parseInt(req.params.id));
    if (delIdx >= 0) DB.episodes.splice(delIdx, 1);
    save();
    backupDb();
    rebuildEpisodeMap();
    res.json({ statusCode: 200, message: "Deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/requests/:id", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    const r = DB.requests.find(x => x.id === parseInt(req.params.id));
    if (r) r.status = req.body.status;
    save();
    res.json({ statusCode: 200, message: "Updated" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/admin/requests", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    const list = [...DB.requests].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const enriched = list.map(r => {
      let u = DB.users.find(x => x.id === r.user_id || x.uid === r.user_id);
      if (!u) { ensureUser(r.user_id); u = DB.users.find(x => x.id === r.user_id || x.uid === r.user_id); }
    return { ...r, user_name: (u?.display_name && u.display_name !== 'Penonton') ? u.display_name : (u?.username || r.user_id), user_email: u?.email || '' };
    });
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/admin/announcements", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    res.json([...DB.announcements].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/announcements", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    DB.announcements.push({ id: DB.announcements.length + 1, content: req.body.content || "", active: true, created_at: now() });
    save();
    res.json({ statusCode: 200, message: "Announcement saved" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/admin/announcements/:id", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    const idx = DB.announcements.findIndex(a => a.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    if (req.body.content !== undefined) DB.announcements[idx].content = req.body.content;
    if (req.body.active !== undefined) DB.announcements[idx].active = req.body.active;
    save();
    res.json({ statusCode: 200, message: "Announcement updated" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/admin/announcements/:id", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    DB.announcements = DB.announcements.filter(a => a.id !== parseInt(req.params.id));
    save();
    res.json({ statusCode: 200, message: "Deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/schedule", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    const dw = (req.body.day_of_week || 'senin').trim();
    const day_of_week = dw.charAt(0).toUpperCase() + dw.slice(1).toLowerCase();
    DB.schedule.push({ id: DB.schedule.length + 1, day_of_week, day: day_of_week, title: req.body.title || "", time: req.body.time || "", anime_id: req.body.anime_id || null });
    save();
    res.json({ statusCode: 200, message: "Schedule saved" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/admin/schedule/:id", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    DB.schedule = DB.schedule.filter(s => s.id !== parseInt(req.params.id));
    save();
    res.json({ statusCode: 200, message: "Deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ── Notifications ─────────────────────────────────────────────────
app.get("/api/notifications", (req, res) => {
  const since = parseInt(req.query.since) || 0;
  let list = DB.notifications || [];
  if (since) list = list.filter(n => n.id > since);
  res.json(list.sort((a, b) => b.id - a.id));
});

app.post("/api/notifications/:id/read", (req, res) => {
  const n = (DB.notifications || []).find(n => n.id === parseInt(req.params.id));
  if (n) {
    if (!n.read_by) n.read_by = [];
    if (!n.read_by.includes(req.body?.userId)) n.read_by.push(req.body?.userId);
    save();
  }
  res.json({ ok: true });
});

app.post("/api/admin/notify", (req, res) => {
  if (!safeEq(req.headers["x-admin-key"], ADMIN_PW)) return res.status(403).json({ error: "Unauthorized" });
  if (!DB.notifications) DB.notifications = [];
  const maxId = DB.notifications.reduce((m, n) => Math.max(m, n.id || 0), 0);
  const notif = { id: maxId + 1, title: req.body.title || '', body: req.body.body || '', type: req.body.type || 'info', target: req.body.target || 'all', read_by: [], created_at: now() };
  DB.notifications.push(notif);
  save();
  io.emit('notification', notif);
  if (admin.apps.length) {
    const tokens = (DB.fcm_tokens || []).map(t => t.token);
    const uniqueTokens = [...new Set(tokens)];
    if (uniqueTokens.length) {
      admin.messaging().sendEachForMulticast({
        tokens: uniqueTokens,
        notification: { title: notif.title || "MahiStream", body: notif.body || "" },
        data: { type: notif.type, id: String(notif.id) },
      }).then((mr) => {
        if (mr.responses && Array.isArray(DB.fcm_tokens)) {
          const bad = [];
          mr.responses.forEach((r, i) => {
            if (!r.success && r.error) {
              const code = r.error.errorCode || r.error.code || '';
              if (/not-registered|invalid|unregistered/i.test(code)) bad.push(uniqueTokens[i]);
            }
          });
          if (bad.length) {
            const before = DB.fcm_tokens.length;
            DB.fcm_tokens = DB.fcm_tokens.filter((t) => !bad.includes(t.token));
            if (DB.fcm_tokens.length !== before) {
              save();
              console.log("[FCM] removed", before - DB.fcm_tokens.length, "invalid tokens, delivered", mr.successCount);
            }
          }
        }
      }).catch(e => console.error("FCM send error:", e.message));
    }
  }
  res.json(notif);
});

app.post("/api/fcm/register", (req, res) => {
  const { userId, token } = req.body;
  if (!userId || !token) return res.status(400).json({ error: "userId and token required" });
  if (!DB.fcm_tokens) DB.fcm_tokens = [];
  const existing = DB.fcm_tokens.find(t => t.userId === userId && t.token === token);
  if (!existing) {
    DB.fcm_tokens.push({ userId, token, createdAt: now() });
    save();
  }
  res.json({ ok: true });
});

app.delete("/api/admin/notifications/:id", (req, res) => {
  if (!safeEq(req.headers["x-admin-key"], ADMIN_PW)) return res.status(403).json({ error: "Unauthorized" });
  const id = parseInt(req.params.id);
  DB.notifications = (DB.notifications || []).filter(n => n.id !== id);
  save();
  res.json({ ok: true });
});

// ── Auth ──────────────────────────────────────────────────────────
app.post("/api/auth/register", (req, res) => {
  if (!rateLimit('auth:' + req.ip, 20)) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username dan password wajib" });
    if (username.length < 3) return res.status(400).json({ error: "Username minimal 3 karakter" });
    if (password.length < 4) return res.status(400).json({ error: "Password minimal 4 karakter" });
    if (DB.users.find(u => u.username === username)) return res.status(409).json({ error: "Username sudah dipakai" });
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.createHash("sha256").update(password + salt).digest("hex");
    const token = crypto.randomBytes(24).toString("hex");
    const userId = "u_" + crypto.randomBytes(6).toString("hex");
    DB.users.push({ id: userId, uid: userId, username, display_name: username, salt, hash, token, created_at: now() });
    save();
    res.json({ user: { id: userId, username, token }, message: "Akun berhasil dibuat" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/auth/login", (req, res) => {
  if (!rateLimit('auth:' + req.ip, 20)) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username dan password wajib" });
    const user = DB.users.find(u => u.username === username || u.id === username);
    if (!user) return res.status(401).json({ error: "Username tidak ditemukan" });
    const hash = crypto.createHash("sha256").update(password + user.salt).digest("hex");
    if (hash !== user.hash) return res.status(401).json({ error: "Password salah" });
    const token = crypto.randomBytes(24).toString("hex");
    user.token = token;
    save();
    res.json({ user: { id: user.id, username: user.username, display_name: user.display_name || user.username, token, role: (user.username === 'admin' ? 'dev' : (user.role || 'user')) } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/auth/me", (req, res) => {
  const token = req.headers["x-auth-token"];
  if (!token) return res.status(401).json({ error: "Token diperlukan" });
  const user = DB.users.find(u => u.token === token);
  if (!user) return res.status(401).json({ error: "Token tidak valid" });
  res.json({ user: { id: user.id, username: user.username, display_name: user.display_name || user.username, role: (user.username === 'admin' ? 'dev' : (user.role || 'user')) } });
});

app.post("/api/auth/link", (req, res) => {
  if (!rateLimit('auth:' + req.ip, 20)) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  try {
    const { token, anonymousId } = req.body;
    if (!token || !anonymousId) return res.status(400).json({ error: "Token dan anonymousId wajib" });
    const user = DB.users.find(u => u.token === token);
    if (!user) return res.status(401).json({ error: "Token tidak valid" });
    const anonHistory = DB.history.filter(h => h.user_id === anonymousId);
    for (const h of anonHistory) {
      h.user_id = user.id;
    }
    save();
    res.json({ message: "Riwayat ditautkan" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Google Auth ────────────────────────────────────────────────────
app.post("/api/auth/google", async (req, res) => {
  if (!rateLimit('auth:' + req.ip, 20)) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  try {
    const { credential, clientId } = req.body;
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "843035088451-oftajg1gqg6e2tks7gp0tfuu27028769.apps.googleusercontent.com";
    if (!credential) return res.status(400).json({ error: "Credential diperlukan" });

    const payload = await fetchJson(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    if (payload.error) return res.status(401).json({ error: "Token Google tidak valid: " + payload.error });

    const aud = GOOGLE_CLIENT_ID;
    if (aud && payload.aud !== aud) return res.status(401).json({ error: "Client ID tidak cocok" });

    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name || email?.split('@')[0] || 'User';
    const picture = payload.picture || '';

    let user = DB.users.find(u => u.google_id === googleId || u.email === email);
    const isOwnerEmail = ADMIN_EMAILS.includes(String(email || "").toLowerCase());
    if (!user) {
      const userId = "u_" + crypto.randomBytes(6).toString("hex");
      const token = crypto.randomBytes(24).toString("hex");
      user = {
        id: userId, uid: userId, username: email, email,
        display_name: name, google_id: googleId, avatar: picture,
        token, created_at: now(), role: isOwnerEmail ? "dev" : "user"
      };
      DB.users.push(user);
    } else {
      user.token = crypto.randomBytes(24).toString("hex");
      if (!user.google_id) user.google_id = googleId;
      if (!user.avatar) user.avatar = picture;
      user.display_name = name;
      if (isOwnerEmail && user.role !== "dev") user.role = "dev";
    }
    save();

    const { anonymousId } = req.body;
    if (anonymousId) {
      DB.history.filter(h => h.user_id === anonymousId).forEach(h => h.user_id = user.id);
      save();
    }

    logActivity(user.id, "login_google", req);
    res.json({ user: { id: user.id, username: user.username, display_name: user.display_name || user.username, avatar: user.avatar, token: user.token } });
  } catch (e) {
    res.status(500).json({ error: "Gagal autentikasi Google: " + (e?.message || e) });
  }
});

// ── PKCE OAuth for Native APK ──────────────────────────────────────
app.post("/api/auth/init-login", (req, res) => {
  if (!rateLimit('auth:' + req.ip, 20)) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  try {
    const state = crypto.randomBytes(16).toString("hex");
    const codeVerifier = crypto.randomBytes(32)
      .toString("base64url")
      .replace(/[^a-zA-Z0-9\-._~]/g, "")
      .slice(0, 128);
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url")
      .replace(/=+$/, "");
    loginStates.set(state, { codeVerifier, done: false, userData: null, createdAt: Date.now() });
    res.json({ state, codeChallenge, codeChallengeMethod: "S256" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/auth/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send("Missing code or state");
    const entry = loginStates.get(state);
    if (!entry) return res.status(400).send("Invalid or expired state");
    const cid = process.env.GOOGLE_CLIENT_ID || "843035088451-oftajg1gqg6e2tks7gp0tfuu27028769.apps.googleusercontent.com";

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: cid,
        code_verifier: entry.codeVerifier,
        redirect_uri: "https://mahistream.duckdns.org/api/auth/callback",
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.id_token) {
      return res.status(400).send("Gagal mendapatkan token: " + JSON.stringify(tokenData));
    }

    const parts = tokenData.id_token.split(".");
    if (parts.length !== 3) return res.status(400).send("Invalid id_token");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    );

    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name || email?.split("@")[0] || "User";
    const picture = payload.picture || "";

    let user = DB.users.find(u => u.google_id === googleId || u.email === email);
    if (!user) {
      const userId = "u_" + crypto.randomBytes(6).toString("hex");
      const token = crypto.randomBytes(24).toString("hex");
      user = {
        id: userId, uid: userId, username: email, email,
        display_name: name, google_id: googleId, avatar: picture,
        token, created_at: now(),
      };
      DB.users.push(user);
    } else {
      user.token = crypto.randomBytes(24).toString("hex");
      if (!user.google_id) user.google_id = googleId;
      if (!user.avatar) user.avatar = picture;
      user.display_name = name;
    }
    save();
    logActivity(user.id, "login_google", req);

    loginStates.set(state, {
      ...entry,
      done: true,
      userData: {
        id: user.id,
        username: user.username,
        display_name: user.display_name || user.username,
        role: user.role || "user",
        token: user.token,
        avatar: user.avatar,
      },
    });

    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login Berhasil</title><style>body{background:#0f0f17;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:sans-serif;text-align:center;padding:20px}div{max-width:400px}h1{color:#22d3ee;font-size:24px}p{color:#94a3b8;line-height:1.6}.check{font-size:48px;margin-bottom:10px}</style></head><body><div><div class="check">&#10004;</div><h1>Login Berhasil!</h1><p>Silakan kembali ke aplikasi MahiStream untuk melanjutkan.</p></div></body></html>`);
  } catch (e) {
    res.status(500).send("Error: " + (e?.message || e));
  }
});

app.get("/api/auth/poll-login", (req, res) => {
  const { state } = req.query;
  if (!state) return res.status(400).json({ error: "Missing state" });
  const entry = loginStates.get(state);
  if (!entry) return res.json({ status: "expired" });
  if (!entry.done) return res.json({ status: "pending" });
  loginStates.delete(state);
  res.json({ status: "ready", user: entry.userData });
});

// ── SPA fallback (serve index.html for non-API routes) ────────────
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  const indexPath = path.join(distPath, "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  next();
});

// ── Global error handler ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("EXPRESS ERROR:", err?.message || err, err?.stack?.split("\n").slice(0, 3).join(" "));
  res.status(500).json({ error: err?.message || "Internal server error" });
});

// ── Config ──────────────────────────────────────────────────────
app.get("/api/config", (req, res) => {
  const gcId = process.env.GOOGLE_CLIENT_ID || "843035088451-oftajg1gqg6e2tks7gp0tfuu27028769.apps.googleusercontent.com";
  const m = readMaintenance();
  res.json({ googleClientId: gcId, maintenance: m.active || DB.maintenance === true, maintenanceMessage: m.message, khususPassword: DB.khusus_password || "animebokep" });
});

// ── Settings (public) ────────────────────────────────────────────
app.get("/api/settings/home-sections", (req, res) => {
  res.json(DB.settings?.homeSections || { recommendations: true, genres: true, schedule: true, trending: true, latest: true, heroIds: [], genres: [], trendingIds: [], recommendationIds: [] });
});

// ── Admin settings ───────────────────────────────────────────────
app.post("/api/admin/home-sections", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    const payload = req.body;
    if (!DB.settings) DB.settings = {};
    if (!DB.settings.homeSections) DB.settings.homeSections = { recommendations: true, genres: true, schedule: true, trending: true, latest: true, heroIds: [], genres: [], trendingIds: [], recommendationIds: [] };
    for (const [k, v] of Object.entries(payload)) {
      DB.settings.homeSections[k] = v;
    }
    save();
    res.json({ statusCode: 200, message: "Home sections updated", data: DB.settings.homeSections });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Community settings ──────────────────────────────────────────
app.get("/api/settings/community", (req, res) => {
  res.json(DB.settings?.community || { telegram_label: "Telegram", telegram_link: "https://t.me/mahistream", wa_label: "WhatsApp", wa_link: "https://chat.whatsapp.com/mahistream", discord_label: "Discord", discord_link: "https://discord.gg/mahistream" });
});

app.post("/api/admin/community", (req, res) => {
  try {
    if (!safeEq(req.headers["x-admin-key"], ADMIN_PW) && (!req.user || (req.user.role !== 'dev' && req.user.role !== 'admin'))) return res.status(403).json({ error: "Unauthorized" });
    const payload = req.body;
    if (!DB.settings) DB.settings = {};
    DB.settings.community = { ...DB.settings.community, ...payload };
    save();
    res.json({ statusCode: 200, message: "Community updated", data: DB.settings.community });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Health ───────────────────────────────────────────────────────
app.get("/api", (req, res) => {
  res.json({ statusCode: 200, statusMessage: "OK", message: "MahiStream API" });
});

process.on("uncaughtException", (e) => console.error("UNCAUGHT:", e?.message || e, e?.stack?.split("\n")[1]?.trim()));
process.on("unhandledRejection", (e) => console.error("UNHANDLED:", e?.message || e, e?.stack?.split("\n")[1]?.trim()));

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ MahiStream API running on http://0.0.0.0:${PORT}`);
  console.log(`  ${DB.anime.length} anime, ${DB.episodes.length} episodes`);
  console.log(`  Frontend: http://VPS_IP:${PORT}`);
});


