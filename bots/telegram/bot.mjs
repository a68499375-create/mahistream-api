import { readFileSync, writeFileSync, existsSync, createWriteStream } from 'fs';
import https from 'node:https';
import path from 'node:path';

const TOKEN = process.env.TG_TOKEN || '8887336411:AAHE4o07RhDINylJqR7n1lyGogzvij4l-CU';
const BOTAPI = process.env.BOTAPI || 'https://api.telegram.org';
const API = BOTAPI + '/bot' + TOKEN;
const ADMIN_KEY = 'alfathsayangkagari';
const MAHI = process.env.MAHI_API || 'https://mahistream-api-production.up.railway.app';
const BASE = process.env.BASE_URL || 'https://mahistream.pages.dev';
const DATA_DIR = process.env.DATA_DIR || '.';
const LOCAL = process.env.LOCAL === '1';
const OWNER_FILE = path.join(DATA_DIR, 'owner.txt');
const OWNER_CHAT = process.env.OWNER_CHAT || (existsSync(OWNER_FILE) ? readFileSync(OWNER_FILE, 'utf8').trim() : '');
let ownerChat = OWNER_CHAT;

const KURAMANIME_ALIASES = {
  RAKUKEN: 'Rakudai Kenja no Gakuin Musou: Nidome no Tensei, S-Rank Cheat Majutsushi Boukenroku',
  SAOSEWA: 'Saijo no Osewa: Takane no Hanadarake na Meimonkou de, Gakuin Ichi no Ojousama (Seikatsu Nouryoku Kaimu) wo Kagenagara Osewa suru Koto ni Narimashita',
};
function setOwnerChat(id) {
  ownerChat = String(id);
  try { writeFileSync(OWNER_FILE, ownerChat); } catch (e) {}
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
function loadUsers() {
  try { return JSON.parse(readFileSync(USERS_FILE, 'utf8') || '[]'); } catch (e) { return []; }
}
function saveUser(id, username) {
  try {
    const users = loadUsers();
    if (!users.find((u) => String(u.id) === String(id))) {
      users.push({ id: String(id), username: username || '', at: Date.now() });
      writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    }
  } catch (e) {}
}
function isOwner(id) {
  return String(id) === String(OWNER_CHAT);
}

const FAV_FILE = path.join(DATA_DIR, 'favorites.json');
function loadFavorites(userId) {
  try {
    const all = JSON.parse(readFileSync(FAV_FILE, 'utf8') || '{}');
    return all[String(userId)] || [];
  } catch (e) { return []; }
}
function addFavorite(userId, animeId) {
  try {
    let all = {};
    try { all = JSON.parse(readFileSync(FAV_FILE, 'utf8') || '{}'); } catch (e) {}
    const uid = String(userId);
    if (!all[uid]) all[uid] = [];
    if (!all[uid].includes(animeId)) {
      all[uid].push(animeId);
      writeFileSync(FAV_FILE, JSON.stringify(all, null, 2));
      return true;
    }
    return false;
  } catch (e) { return false; }
}
function removeFavorite(userId, animeId) {
  try {
    let all = {};
    try { all = JSON.parse(readFileSync(FAV_FILE, 'utf8') || '{}'); } catch (e) {}
    const uid = String(userId);
    if (all[uid]) {
      all[uid] = all[uid].filter((x) => String(x) !== String(animeId));
      writeFileSync(FAV_FILE, JSON.stringify(all, null, 2));
      return true;
    }
    return false;
  } catch (e) { return false; }
}

const SUBS_FILE = path.join(DATA_DIR, 'subscribers.json');
function loadSubscribers(userId) {
  try {
    const all = JSON.parse(readFileSync(SUBS_FILE, 'utf8') || '{}');
    return all[String(userId)] || [];
  } catch (e) { return []; }
}
function loadAllSubscribers() {
  try { return JSON.parse(readFileSync(SUBS_FILE, 'utf8') || '{}'); } catch (e) { return {}; }
}
function addSubscriber(userId, animeId) {
  try {
    let all = {};
    try { all = JSON.parse(readFileSync(SUBS_FILE, 'utf8') || '{}'); } catch (e) {}
    const uid = String(userId);
    if (!all[uid]) all[uid] = [];
    if (!all[uid].includes(animeId)) {
      all[uid].push(animeId);
      writeFileSync(SUBS_FILE, JSON.stringify(all, null, 2));
      return true;
    }
    return false;
  } catch (e) { return false; }
}
function removeSubscriber(userId, animeId) {
  try {
    let all = {};
    try { all = JSON.parse(readFileSync(SUBS_FILE, 'utf8') || '{}'); } catch (e) {}
    const uid = String(userId);
    if (all[uid]) {
      all[uid] = all[uid].filter((x) => String(x) !== String(animeId));
      writeFileSync(SUBS_FILE, JSON.stringify(all, null, 2));
      return true;
    }
    return false;
  } catch (e) { return false; }
}
async function notifySubscribers(animeId, animeTitle, epNum, streamUrl) {
  try {
    const all = loadAllSubscribers();
    for (const [chatId, animeIds] of Object.entries(all)) {
      if (animeIds.includes(String(animeId)) || animeIds.includes(animeId)) {
        await send(chatId, '[MahiStream] Episode ' + epNum + ' "' + animeTitle + '" sudah tayang!\nTonton: ' + streamUrl + '\n\nBuka di web: ' + BASE + '/anime/' + animeId);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  } catch (e) { console.error('[err] notifySubs', e.message); }
}

const pendingEpisodes = new Map();
const pendingSinopsis = new Map();
let MIGRATING = existsSync('/tmp/MAHI_MIGRATING');

const REPLY_KB = {
  keyboard: [
    ['Cari', 'Random', 'Top'],
    ['Favorit', 'Genre', 'Stats'],
    ['Menu', 'Help'],
  ],
  resize_keyboard: true,
};

function sendUser(chat_id, text, opts) {
  const o = opts || {};
  o.reply_markup = REPLY_KB;
  return send(chat_id, text, o);
}

let lastUpdate = 0;
let lastRequestPoll = 0;
let lastStatusSync = 0;

function normAlt(a) {
  if (!a) return [];
  if (Array.isArray(a)) return a.map((x) => String(x).toLowerCase());
  if (typeof a === 'string') return a.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return [];
}

async function getAnimeList() {
  const r = await fetch(MAHI + '/api/anime?limit=300');
  const d = await r.json();
  return d.animeList || d.data || d.anime || [];
}

async function getKhususList() {
  try {
    const r = await fetch(MAHI + '/api/khusus');
    if (!r.ok) return [];
    const d = await r.json();
    const items = Array.isArray(d) ? d : (d.items || d.khusus || []);
    return (Array.isArray(items) ? items : []).map((k) => ({ ...k, khusus: true }));
  } catch (e) {
    return [];
  }
}

async function saveAnimeEpisode(animeId, num, res, streamUrl) {
  const body = {
    anime_id: animeId,
    number: num,
    title: 'Episode ' + num,
    gdrive_links: JSON.stringify([{ label: res, url: streamUrl }]),
  };
  const r = await fetch(MAHI + '/api/admin/episodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  return { ok: r.ok, status: r.status, message: d.message || '' };
}

async function saveKhususEpisode(animeId, title, num, res, streamUrl) {
  let links = [];
  try {
    const kr = await fetch(MAHI + '/api/khusus/' + encodeURIComponent(animeId));
    if (kr.ok) {
      const kd = await kr.json();
      links = Array.isArray(kd.gdrive_links) ? kd.gdrive_links : [];
    }
  } catch (e) {}
  if (links.some((l) => parseInt(l.episode, 10) === num)) {
    return { ok: false, status: 0, dup: true };
  }
  links.push({ episode: num, url: streamUrl, label: res });
  const r = await fetch(MAHI + '/api/admin/khusus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
    body: JSON.stringify({ id: animeId, title: title || animeId, gdrive_links: JSON.stringify(links) }),
  });
  const d = await r.json();
  return { ok: r.ok, status: r.status, message: d.message || '', dup: false };
}

function shortTitle(a) {
  const main = String(a.title || a.id || '');
  if (main.length <= 30) return main;
  const alts = [];
  if (a.title_english) alts.push(String(a.title_english));
  if (Array.isArray(a.alt_titles)) alts.push(...a.alt_titles.map(String));
  else if (a.alt_titles) alts.push(...String(a.alt_titles).split(/[,;]/).map(s => s.trim()).filter(Boolean));
  const good = alts.filter(s => s.length >= 4 && s.length < main.length);
  return good.length ? good.sort((x, y) => x.length - y.length)[0] : main;
}

async function detectGaps() {
  const list = await getAnimeList();
  const report = [];
  for (const a of list) {
    try {
      const r = await fetch(MAHI + '/api/episodes/' + encodeURIComponent(a.id));
      if (!r.ok) continue;
      const ed = await r.json();
      const eps = Array.isArray(ed) ? ed : (ed.episodeList || ed.data || ed.episodes || []);
      if (!Array.isArray(eps) || !eps.length) continue;
      const nums = eps.map((e) => parseInt(e.number, 10)).filter((n) => !isNaN(n) && n > 0).sort((x, y) => x - y);
      const max = Math.max(...nums);
      const missing = [];
      for (let n = 1; n <= max; n++) if (!nums.includes(n)) missing.push(n);
      if (missing.length) report.push({ title: shortTitle(a), id: a.id, count: eps.length, max, missing });
    } catch (e) {}
  }
  return report;
}

function fuzzyMatch(abbrev, title) {
  if (abbrev.length < 4 || title.length < 4) return false;
  if (title.startsWith(abbrev)) return true;
  if (abbrev.length / title.length < 0.4) return false;
  let i = 0;
  for (const ch of title) {
    if (ch === abbrev[i]) i++;
    if (i === abbrev.length) return true;
  }
  return false;
}

function matchAnime(list, title, season) {
  const t = title.toLowerCase();
  const sNum = season ? parseInt(season) : null;
  const candidates = [];
  for (const a of list) {
    const alts = [a.title, a.title_jp, ...normAlt(a.alt_titles)].map((x) => String(x).toLowerCase()).filter(Boolean);
    for (const alt of alts) {
      if (alt.includes(t) || t.includes(alt)) {
        if (sNum) {
          const hasSeason = /\bseason\s*(\d+)\b/i.test(alt) || /\bs(\d+)\b/i.test(alt) || alt.includes('season ' + sNum);
          if (hasSeason) candidates.push({ anime: a, score: 3 });
          else candidates.push({ anime: a, score: 1 });
        } else {
          candidates.push({ anime: a, score: 2 });
        }
        break;
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > 0) {
    if (sNum) {
      const exact = candidates.find(c => /\bseason\s*(\d+)\b/i.test(c.anime.title.toLowerCase()) && RegExp.$1 === String(sNum));
      if (exact) return exact.anime;
    }
    return candidates[0].anime;
  }
  for (const a of list) {
    const alts = [a.title, a.title_jp].map((x) => String(x).toLowerCase()).filter(Boolean);
    for (const alt of alts) {
      if (alt.split(' ').some((w) => w.length > 3 && t.includes(w))) {
        return a;
      }
    }
  }
  for (const a of list) {
    const alts = [a.title, a.title_jp, ...normAlt(a.alt_titles)].map((x) => String(x).toLowerCase()).filter(Boolean);
    for (const alt of alts) {
      if (fuzzyMatch(t, alt)) {
        return a;
      }
    }
  }
  return null;
}

function matchAnimeAll(list, title, season) {
  const t = title.toLowerCase();
  const sNum = season ? parseInt(season) : null;
  const candidates = [];
  for (const a of list) {
    const alts = [a.title, a.title_jp, ...normAlt(a.alt_titles)].map((x) => String(x).toLowerCase()).filter(Boolean);
    for (const alt of alts) {
      if (alt.includes(t) || t.includes(alt)) {
        let score = 2;
        if (sNum) {
          const m = alt.match(/\bseason\s*(\d+)\b/i) || alt.match(/\bs(\d+)\b/i);
          if (m && parseInt(m[1]) === sNum) score = 3;
          else score = 1;
        }
        candidates.push({ anime: a, score });
        break;
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length === 0) {
    for (const a of list) {
      const alts = [a.title, a.title_jp, ...normAlt(a.alt_titles)].map((x) => String(x).toLowerCase()).filter(Boolean);
      for (const alt of alts) {
        if (fuzzyMatch(t, alt)) {
          candidates.push({ anime: a, score: 1 });
          break;
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
  }
  return candidates.map((c) => c.anime);
}

function parseCaption(text) {
  const m = text.match(/eps?\s*(\d+)/i);
  const num = m ? parseInt(m[1]) : null;
  const rm = text.match(/reso?\s*(\S+)/i) || text.match(/(\d{3,4})p/i);
  const res = rm ? rm[1].replace(/[^0-9p]/g, '') || null : null;
  const seasonM = text.match(/\bs(\d+)\b/i);
  const season = seasonM ? seasonM[1] : null;
  let title = text
    .replace(/eps?\s*\d+/gi, '')
    .replace(/reso?\s*\S+/gi, '')
    .replace(/\d{3,4}p/gi, '')
    .replace(/\bs\d+\b/gi, '')
    .replace(/reso/gi, '')
    .replace(/\beps\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { title, num, res, season };
}

function parseFileName(name) {
  if (!name) return null;
  let num = null;
  const numM = name.match(/\b(?:ep(?:isode)?[-_ ]?)(\d+)/i)
    || name.match(/(?:--|_|-)(\d{1,3})(?:_|-)/)
    || name.match(/[-_](\d{1,3})(?:[-_ ]|$)/)
    || name.match(/\b(\d{1,3})(?:v\d)?\b/);
  if (numM) num = parseInt(numM[1]);
  let t = name;
  if (/^kuramanime/i.test(t)) {
    const m = t.match(/^kuramanime(?:[_\s-]*[A-Z]{2})?[_\s-]*(.+?)_?episode[_\s-]*\d+/i)
      || t.match(/^kuramanime[_\s-]*(.+?)_?(?:BD|END|-?\d{3,4}p|ep\d|-\w+)/i);
    t = m ? m[1] : t.replace(/^kuramanime[_\s-]*(?:[A-Z]{2}[_\s-]*)?/i, '');
    t = t.replace(/sub\s*indo/i, '').replace(/_\s*$/, '');
  } else if (/^otakudesu/i.test(t)) {
    const m = t.match(/^otakudesu[_\s]*(.+?)(?:--\d+|\s*-\s*\d+|_)/i);
    t = m ? m[1] : t.replace(/^otakudesu[_\s]*/i, '');
  } else if (/^\[nekopoi\]/i.test(t)) {
    const m = t.match(/^\[nekopoi\]\s*(.+?)\s*-\s*\d+/i);
    t = m ? m[1] : t.replace(/^\[nekopoi\]\s*/i, '');
  } else {
    const m = t.match(/(.+?)\s*-\s*(?:episode\s*)?\d+/i)
      || t.match(/(.+?)[_\s-]+ep\d+/i);
    t = m ? m[1] : t;
  }
  t = t.replace(/\(\d{3,4}p\)/gi, '').replace(/[-_]?\d{3,4}p/gi, '');
  t = t.replace(/\bep(?:isode)?[-_ ]?\d+/gi, '').replace(/\bsub\s*indo\b/gi, '');
  t = t.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const rm = name.match(/reso?\s*(\S+)/i) || name.match(/(\d{3,4})p/i);
  const res = rm ? rm[1].replace(/[^0-9p]/g, '') || null : null;
  const seasonM = name.match(/\bs(\d+)\b/i);
  const season = seasonM ? seasonM[1] : null;
  return { title: t || null, num, res, season };
}

async function send(chat_id, text, opts) {
  try {
    const payload = { chat_id, text };
    if (opts && opts.reply_markup) payload.reply_markup = opts.reply_markup;
    if (opts && opts.parse_mode) payload.parse_mode = opts.parse_mode;
    await fetch(API + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('[err] send', e.message);
  }
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendChunks(chat_id, text, opts) {
  const MAX = 3500;
  if (text.length <= MAX) {
    await send(chat_id, text, opts);
    return;
  }
  const lines = text.split('\n');
  let buf = '';
  for (const ln of lines) {
    if (buf && (buf + ln).length > MAX) {
      await send(chat_id, buf, opts);
      buf = '';
    }
    buf += ln + '\n';
  }
  if (buf.trim()) await send(chat_id, buf, opts);
}

async function sendChannel(chat_id, text) {
  try {
    await fetch(API + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text }),
    });
  } catch (e) {
    console.error('[err] sendChannel', e.message);
  }
}

async function handleVideo(msg) {
  const fileId = msg.video.file_id;
  const caption = msg.caption || '';
  const fileName = msg.video.file_name || '';
  const parsed = parseCaption(caption || '');
  const fileTitle = parseFileName(fileName);
  const title = parsed.title || (fileTitle && fileTitle.title);
  const num = parsed.num || (fileTitle && fileTitle.num);
  if (!num) {
    console.log('[skip] no episode number in caption:', caption, '| file:', fileName);
    try {
      const gf = await fetch(API + '/getFile?file_id=' + encodeURIComponent(fileId));
      const gfd = await gf.json();
      if (gfd.ok && gfd.result) {
        const rawPath = gfd.result.file_path || '';
        const fn = rawPath.split('/').pop() || '';
        if (fn && fn !== 'file_0.mp4' && !/^file_\d+\.mp4$/.test(fn)) {
          const ft = parseFileName(fn);
          if (ft && ft.num) {
            parsed.title = parsed.title || ft.title;
            parsed.num = ft.num;
            parsed.res = parsed.res || ft.res || '720p';
            parsed.season = parsed.season || ft.season;
            num = ft.num;
            console.log('[fix] got num from file_path:', fn, 'num:', ft.num);
          }
        }
      }
    } catch (e) {
      console.log('[err] getFile fallback:', e.message);
    }
  }
  if (!num) {
    const guessTitle = parsed.title || (fileTitle && fileTitle.title) || '';
    let kMatch = null;
    if (guessTitle) {
      const kl = await getKhususList().catch(() => []);
      const g = guessTitle.toLowerCase();
      kMatch = kl.find((k) => {
        const t = String(k.title || '').toLowerCase();
        return t.includes(g) || g.includes(t);
      });
    }
    if (kMatch) {
      parsed.title = kMatch.title;
      parsed.num = (Array.isArray(kMatch.gdrive_links) ? kMatch.gdrive_links.length : 0) + 1;
      parsed.res = parsed.res || '720p';
      num = parsed.num;
      console.log('[ok khusus] auto-ep for', kMatch.title, 'num:', num);
    } else {
      const cid = (msg.chat && msg.chat.type === 'private') ? String(msg.chat.id) : (OWNER_CHAT || (msg.chat.id < 0 ? String(msg.chat.id) : ''));
      if (cid) await send(cid, '[Bot] Video tanpa caption diterima. Format caption: Nama Anime Episode 1 720p');
      return;
    }
  }
  parsed.num = num;
  if (!parsed.title && fileTitle && fileTitle.title) parsed.title = fileTitle.title;
  parsed.res = parsed.res || (fileTitle && fileTitle.res) || '720p';
  parsed.season = parsed.season || (fileTitle && fileTitle.season);
  const matchTitle = KURAMANIME_ALIASES[String(title || '').toUpperCase()] || title;
  const list = [...(await getAnimeList()), ...(await getKhususList())];
  let anime = null;
  if (parsed.season) {
    anime = matchAnime(list, matchTitle, parsed.season);
  } else {
    const all = matchAnimeAll(list, matchTitle);
    if (all.length === 0) {
      console.log('[try] anime not in DB, searching Jikan:', matchTitle, '| file:', fileName);
      const added = await addAnimeFromJikan(matchTitle, null);
      if (added && added.id) {
        anime = { id: added.id, title: added.title || title };
        console.log('[ok] auto-added anime via Jikan:', anime.title, 'id:', added.id);
      }
      if (!anime) {
        console.log('[skip] anime not matched:', title, '| file:', fileName);
        if (msg.chat && msg.chat.type === 'private') {
          await send(msg.chat.id, '[Bot] Anime tidak ditemukan untuk: "' + title + '" (file: ' + fileName + '). Tambahkan manual di DevPanel.');
        } else if (msg.chat && msg.chat.type === 'channel') {
          const cid = OWNER_CHAT || (msg.chat.id < 0 ? String(msg.chat.id) : '');
          if (cid) await send(cid, '[Bot] Anime tidak ditemukan untuk: "' + title + '" (file: ' + fileName + '). Tambahkan manual di DevPanel.');
        }
        return;
      }
    } else if (all.length === 1) {
      anime = all[0];
    } else {
      const cid = (msg.chat && msg.chat.type === 'private') ? String(msg.chat.id) : (OWNER_CHAT || (msg.chat.id < 0 ? String(msg.chat.id) : ''));
      if (cid) {
        const key = 'ep' + msg.chat.id + '_' + msg.message_id;
        const chId = msg.forward_from_chat ? String(msg.forward_from_chat.id) : String(msg.chat.id);
        const mId = msg.forward_from_message_id ? String(msg.forward_from_message_id) : String(msg.message_id);
        pendingEpisodes.set(key, { parsed, fileId, chatId: chId, messageId: mId, title });
        const kb = { inline_keyboard: all.map((a) => ([{ text: a.title, callback_data: 'ep:' + a.id + ':' + key }])) };
        await send(cid, '[Bot] Pilih anime untuk Episode ' + parsed.num + ' (' + parsed.res + ') dari file: ' + fileName, { reply_markup: kb });
      }
      return;
    }
  }
  if (!anime) {
    console.log('[try] anime not in DB, searching Jikan:', matchTitle, '| file:', fileName);
    const j = await anilistSearch(matchTitle);
    if (j) {
      const added = await addAnimeFromJikan(j.title, null);
      if (added && added.id) {
        anime = { id: added.id, title: j.title };
        console.log('[ok] auto-added anime via Jikan:', j.title, 'id:', added.id);
      }
    }
    if (!anime) {
      console.log('[skip] anime not matched:', title, '| file:', fileName);
      const cid = (msg.chat && msg.chat.type === 'private') ? String(msg.chat.id) : (OWNER_CHAT || (msg.chat.id < 0 ? String(msg.chat.id) : ''));
      if (cid) await send(cid, '[Bot] Anime tidak ditemukan untuk: "' + title + '" (file: ' + fileName + '). Tambahkan manual di DevPanel.');
      return;
    }
  }
  const gf = await fetch(API + '/getFile?file_id=' + encodeURIComponent(fileId));
  const gfd = await gf.json();
  if (!gfd.ok) {
    console.log('[err] getFile failed', gfd);
    return;
  }
  const filePath = gfd.result.file_path;
  const tgChatId = msg.forward_from_chat ? String(msg.forward_from_chat.id) : String(msg.chat.id);
  const tgMsgId = msg.forward_from_message_id ? String(msg.forward_from_message_id) : String(msg.message_id);
  const streamUrl = BASE + '/api/telegram/' + tgChatId + '/' + tgMsgId;
  const saved = anime.khusus ? await saveKhususEpisode(anime.id, anime.title, parsed.num, parsed.res, streamUrl) : await saveAnimeEpisode(anime.id, parsed.num, parsed.res, streamUrl);
  if (saved.dup) {
    console.log('[ok] duplicate episode skipped for', anime.title, 'eps', parsed.num);
    const dupNotif = '[Bot] Episode ' + parsed.num + ' "' + anime.title + '" (' + parsed.res + ') sudah ada, dilewati.';
    if (msg.chat && msg.chat.type === 'private') { await send(msg.chat.id, dupNotif); } else if (ownerChat) { await send(ownerChat, dupNotif); }
    return;
  }
  console.log('[ok] episode saved for', anime.title, 'eps', parsed.num, '->', saved.status, saved.message);
  const notif = '[Bot] Episode ' + parsed.num + ' "' + anime.title + '" (' + parsed.res + ') berhasil ditambahkan.\n' + streamUrl;
  if (msg.chat && msg.chat.type === 'private') {
    await send(msg.chat.id, notif);
  } else if (ownerChat) {
    await send(ownerChat, notif);
  }
  if (msg.chat && msg.chat.type === 'channel') await sendChannel(String(msg.chat.id), 'Episode ' + parsed.num + ' "' + anime.title + '" (' + parsed.res + ') sudah tersedia!\n' + streamUrl);
}

async function handleDocument(msg) {
  const doc = msg.document || {};
  const fileId = doc.file_id;
  const fileName = doc.file_name || '';
  const caption = msg.caption || '';
  const parsed = parseCaption(caption || '');
  const fileTitle = parseFileName(fileName);
  const title = parsed.title || (fileTitle && fileTitle.title);
  const num = parsed.num || (fileTitle && fileTitle.num);
  parsed.res = parsed.res || (fileTitle && fileTitle.res) || '720p';
  parsed.season = parsed.season || (fileTitle && fileTitle.season);
  if (!num) {
    console.log('[skip doc] no episode number:', caption, '|', fileName);
    try {
      const gf = await fetch(API + '/getFile?file_id=' + encodeURIComponent(fileId));
      const gfd = await gf.json();
      if (gfd.ok && gfd.result) {
        const rawPath = gfd.result.file_path || '';
        const fn = rawPath.split('/').pop() || '';
        if (fn && fn !== 'file_0.mp4' && !/^file_\d+\.mp4$/.test(fn)) {
          const ft = parseFileName(fn);
          if (ft && ft.num) {
            parsed.title = parsed.title || ft.title;
            parsed.num = ft.num;
            parsed.res = parsed.res || ft.res || '720p';
            parsed.season = parsed.season || ft.season;
            num = ft.num;
          }
        }
      }
    } catch (e) {}
  }
  if (!num) {
    const guessTitle = parsed.title || (fileTitle && fileTitle.title) || '';
    let kMatch = null;
    if (guessTitle) {
      const kl = await getKhususList().catch(() => []);
      const g = guessTitle.toLowerCase();
      kMatch = kl.find((k) => {
        const t = String(k.title || '').toLowerCase();
        return t.includes(g) || g.includes(t);
      });
    }
    if (kMatch) {
      parsed.title = kMatch.title;
      parsed.num = (Array.isArray(kMatch.gdrive_links) ? kMatch.gdrive_links.length : 0) + 1;
      parsed.res = parsed.res || '720p';
      num = parsed.num;
      console.log('[ok doc khusus] auto-ep for', kMatch.title, 'num:', num);
    } else {
      const cid = (msg.chat && msg.chat.type === 'private') ? String(msg.chat.id) : (OWNER_CHAT || (msg.chat.id < 0 ? String(msg.chat.id) : ''));
      if (cid) await send(cid, '[Bot] File/document tanpa caption diterima. Format caption: Nama Anime Episode 1 720p');
      return;
    }
  }
  parsed.num = num;
  if (!parsed.title && fileTitle && fileTitle.title) parsed.title = fileTitle.title;
  parsed.res = parsed.res || (fileTitle && fileTitle.res) || '720p';
  const matchTitle = KURAMANIME_ALIASES[String(title || '').toUpperCase()] || title;
  const list = [...(await getAnimeList()), ...(await getKhususList())];
  let anime = null;
  if (parsed.season) {
    anime = matchAnime(list, matchTitle, parsed.season);
  } else {
    const all = matchAnimeAll(list, matchTitle);
    if (all.length === 0) {
      console.log('[try doc] anime not in DB, searching Jikan:', matchTitle);
      const j = await anilistSearch(matchTitle);
      if (j) {
        const added = await addAnimeFromJikan(j.title, null);
        if (added && added.id) {
          anime = { id: added.id, title: j.title };
          console.log('[ok doc] auto-added anime via Jikan:', j.title, 'id:', added.id);
        }
      }
      if (!anime) {
        console.log('[skip doc] anime not matched:', title);
        if (msg.chat && msg.chat.type === 'private') {
          await send(msg.chat.id, '[Bot] (doc) Anime tidak ditemukan: "' + title + '" file: ' + fileName);
        } else if (ownerChat) {
          await send(ownerChat, '[Bot] (doc) Anime tidak ditemukan: "' + title + '" file: ' + fileName);
        }
        return;
      }
    } else if (all.length === 1) {
      anime = all[0];
    } else {
      const cid = (msg.chat && msg.chat.type === 'private') ? String(msg.chat.id) : (OWNER_CHAT || (msg.chat.id < 0 ? String(msg.chat.id) : ''));
      if (cid) {
        const key = 'ep' + msg.chat.id + '_' + msg.message_id;
        pendingEpisodes.set(key, { parsed, fileId, chatId: msg.chat.id, messageId: msg.message_id, title });
        const kb = { inline_keyboard: all.map((a) => ([{ text: a.title, callback_data: 'ep:' + a.id + ':' + key }])) };
        await send(cid, '[Bot] (doc) Pilih anime untuk Episode ' + parsed.num + ' (' + parsed.res + '): ' + fileName, { reply_markup: kb });
      }
      return;
    }
  }
  if (!anime) { console.log('[skip doc] anime not matched:', title); return; }
  const gf = await fetch(API + '/getFile?file_id=' + encodeURIComponent(fileId));
  const gfd = await gf.json();
  if (!gfd.ok) { console.log('[err doc] getFile', gfd); return; }
  const filePath = gfd.result.file_path;
  const tgChatId = msg.forward_from_chat ? String(msg.forward_from_chat.id) : String(msg.chat.id);
  const tgMsgId = msg.forward_from_message_id ? String(msg.forward_from_message_id) : String(msg.message_id);
  const streamUrl = BASE + '/api/telegram/' + tgChatId + '/' + tgMsgId;
  const saved = anime.khusus ? await saveKhususEpisode(anime.id, anime.title, parsed.num, parsed.res, streamUrl) : await saveAnimeEpisode(anime.id, parsed.num, parsed.res, streamUrl);
  if (saved.dup) {
    console.log('[ok doc] duplicate episode skipped for', anime.title, 'eps', parsed.num);
    const dupNotif = '[Bot] (doc) Episode ' + parsed.num + ' "' + anime.title + '" (' + parsed.res + ') sudah ada, dilewati.';
    if (msg.chat && msg.chat.type === 'private') { await send(msg.chat.id, dupNotif); } else if (ownerChat) { await send(ownerChat, dupNotif); }
    return;
  }
  console.log('[ok doc] episode saved', anime.title, 'eps', parsed.num, '->', saved.status);
  const notif = '[Bot] (doc) Episode ' + parsed.num + ' "' + anime.title + '" (' + parsed.res + ') berhasil ditambahkan.\n' + streamUrl;
  if (msg.chat && msg.chat.type === 'private') {
    await send(msg.chat.id, notif);
  } else if (ownerChat) {
    await send(ownerChat, notif);
  }
  if (msg.chat && msg.chat.type === 'channel') await sendChannel(String(msg.chat.id), 'Episode ' + parsed.num + ' "' + anime.title + '" (' + parsed.res + ') sudah tersedia!\n' + streamUrl);
}

async function handleBatchFile(msg) {
  const doc = msg.document || {};
  const fileName = (doc.file_name || '').toLowerCase();
  if (!fileName.endsWith('.txt')) {
    await send(msg.chat.id, '[Bot] Kirim file .txt berisi list perintah (1 baris = 1 perintah). Contoh:\nadd Naruto\nupdate One Piece\nrequest Solo Leveling');
    return;
  }
  try {
    const gf = await fetch(API + '/getFile?file_id=' + encodeURIComponent(doc.file_id));
    const gfd = await gf.json();
    if (!gfd.ok) { await send(msg.chat.id, '[Bot] Gagal membaca file.'); return; }
    const filePath = gfd.result.file_path;
    const dl = await fetch(API + '/file/bot' + TOKEN + '/' + filePath);
    const text = await dl.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    await send(msg.chat.id, '[Bot] Memproses ' + lines.length + ' baris dari file...');
    for (const line of lines) {
      const low = line.toLowerCase();
      if (low.startsWith('add ') || low.startsWith('request ')) {
        const name = line.slice(4).trim();
        await send(msg.chat.id, '[Bot] ' + (low.startsWith('add ') ? 'Add' : 'Request') + ': ' + name);
        await addAnimeFromJikan(name, String(msg.chat.id));
      } else if (low.startsWith('update ')) {
        const name = line.slice(7).trim();
        const list = await getAnimeList();
        const found = matchAnime(list, name);
        await send(msg.chat.id, '[Bot] Update: ' + name);
        await addAnimeFromJikan(name, String(msg.chat.id), found ? found.id : undefined);
      } else {
        await send(msg.chat.id, '[Bot] Baris tidak dikenali: ' + line);
      }
      await new Promise(r => setTimeout(r, 300));
    }
    await send(msg.chat.id, '[Bot] Selesai memproses file.');
  } catch (e) {
    await send(msg.chat.id, '[Bot] Gagal memproses file: ' + e.message);
  }
}

function parseAired(str) {
  if (!str) return null;
  const m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  return null;
}

async function anilistSearch(name) {
  try {
    const q = `query ($s: String) { Page(perPage: 8) { media(search: $s, type: ANIME) { title { romaji english native } synonyms genres averageScore startDate { year month day } endDate { year month day } format description(asHtml: false) } } }`;
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: q, variables: { s: name } }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const arr = (d.data && d.data.Page && d.data.Page.media) || [];
    if (!arr.length) return null;
    const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const vn = norm(name);
    let best = null, bestScore = 0;
    for (const m of arr) {
      const titles = [m.title.romaji, m.title.english, m.title.native, ...(m.synonyms || [])];
      let score = 0;
      for (const t of titles) {
        if (!t) continue;
        const tn = norm(t);
        if (tn === vn) { score = 100; break; }
        if (tn.includes(vn) || vn.includes(tn)) score = Math.max(score, 85);
      }
      if (!score) {
        const vwords = vn.split(' ').filter(w => w.length > 3);
        const twords = norm((m.title.romaji || '') + ' ' + (m.title.english || '')).split(' ');
        const common = vwords.filter(w => twords.includes(w)).length;
        if (vwords.length && common >= Math.min(2, vwords.length)) score = 70;
      }
      if (score > bestScore) { bestScore = score; best = m; }
    }
    if (best && bestScore >= 70) {
      const fmt = (best.format === 'MOVIE') ? 'Movie' : (best.format === 'TV' ? 'TV' : (best.format || 'TV'));
      const yr = best.startDate && best.startDate.year ? String(best.startDate.year) : null;
      return {
        source: 'anilist',
        title: best.title.romaji || best.title.english,
        title_english: best.title.english || '',
        title_japanese: best.title.native || '',
        synopsis: best.description || '',
        genres: best.genres || [],
        score: best.averageScore ? (best.averageScore / 10).toFixed(2) : null,
        aired: {
          from: best.startDate ? [best.startDate.year, best.startDate.month, best.startDate.day].filter(Boolean).map(n => String(n).padStart(2, '0')).join('-') : null,
          to: best.endDate ? [best.endDate.year, best.endDate.month, best.endDate.day].filter(Boolean).map(n => String(n).padStart(2, '0')).join('-') : null,
        },
        type: fmt,
        status: (best.endDate && best.endDate.year) ? 'complete' : 'ongoing',
      };
    }
  } catch (e) {
    console.error('[err] anilist', e.message);
  }
  return null;
}

async function jikanSearch(name) {
  const variants = [name];
  const short = name.replace(/\b(BD|END|COMPLETE|SUB|IND|SUB indo|batch|ova|special|movie|season \d+)\b/gi, '').replace(/\s+/g, ' ').trim();
  if (short && short !== name) variants.push(short);
  const firstWords = name.split(' ').slice(0, 3).join(' ');
  if (firstWords && firstWords !== name) variants.push(firstWords);
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const v of variants) {
    let best = null, bestScore = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch('https://api.jikan.moe/v4/anime?q=' + encodeURIComponent(v) + '&limit=8');
        if (r.status === 429) { await new Promise(res => setTimeout(res, 1200)); continue; }
        if (!r.ok) break;
        const d = await r.json();
        const arr = d.data || [];
        if (arr.length) {
          for (const a of arr) {
            const titles = [a.title, a.title_english, a.title_japanese, ...(a.title_synonyms || [])];
            const vn = norm(v);
            let score = 0;
            for (const t of titles) {
              if (!t) continue;
              const tn = norm(t);
              if (tn === vn) { score = 100; break; }
              if (tn.includes(vn) || vn.includes(tn)) score = Math.max(score, 85);
            }
            if (!score) {
              const vwords = vn.split(' ').filter(w => w.length > 3);
              const twords = norm((a.title || '') + ' ' + (a.title_english || '')).split(' ');
              const common = vwords.filter(w => twords.includes(w)).length;
              if (vwords.length && common >= Math.min(2, vwords.length)) score = 70;
            }
            if (score > bestScore) { bestScore = score; best = a; }
          }
          if (best && bestScore >= 70) {
            best.statusNorm = (best.status === 'Finished Airing') ? 'complete'
              : (best.status === 'Currently Airing') ? 'ongoing'
              : (best.status === 'Not yet aired') ? 'upcoming' : 'ongoing';
            return best;
          }
        break;
        }
      } catch (e) {
        console.error('[err] jikan', e.message);
        await new Promise(res => setTimeout(res, 1200));
      }
    }
    if (best) {
      best.statusNorm = (best.status === 'Finished Airing') ? 'complete'
        : (best.status === 'Currently Airing') ? 'ongoing'
        : (best.status === 'Not yet aired') ? 'upcoming' : 'ongoing';
      return best;
    }
  }
  return null;
}

async function translateChunk(q) {
  try {
    const r = await fetch('https://api.mymemory.translated.net/get?langpair=en|id&q=' + encodeURIComponent(q));
    const d = await r.json();
    if (d && d.responseData && d.responseData.translatedText) {
      return d.responseData.translatedText.trim();
    }
  } catch (e) {
    console.error('[err] translate', e.message);
  }
  return q;
}

async function translateToId(text) {
  if (!text || text.length < 10) return text;
  const chunks = [];
  for (let i = 0; i < text.length; i += 480) chunks.push(text.slice(i, i + 480));
  const out = [];
  for (const c of chunks) out.push(await translateChunk(c));
  const joined = out.join(' ').trim();
  return joined || text;
}

function toGenreArray(g) {
  if (!g) return [];
  if (Array.isArray(g)) return g.map((x) => (typeof x === 'string' ? x : x.name)).filter(Boolean).slice(0, 8);
  return [];
}

async function addAnimeFromJikan(name, notifyChat, existingId) {
  let j = await anilistSearch(name);
  let src = 'AniList';
  if (!j) {
    j = await jikanSearch(name);
    src = 'Jikan';
  }
  if (!j) {
    const payload = {
      id: existingId || undefined,
      title: name,
      title_jp: name,
      alt_titles: [],
      synopsis: '',
      genre: '',
      rating: '0',
      aired_from: null,
      aired_to: null,
      type: 'TV',
      status: 'ongoing',
      featured: false,
      trending: false,
      poster: '',
      gdrive_links: '',
    };
    const r = await fetch(MAHI + '/api/admin/anime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    console.log('[ok] anime added (no metadata) fallback:', name, '->', r.status);
    if (notifyChat) await send(notifyChat, '[Bot] "' + name + '" ditambahkan (tanpa metadata).');
    return d;
  }
  const airedFrom = j.aired && j.aired.from ? (j.source === 'anilist' ? j.aired.from : parseAired(j.aired.from)) : null;
  const airedTo = j.aired && j.aired.to ? (j.source === 'anilist' ? j.aired.to : parseAired(j.aired.to)) : null;
  const genre = toGenreArray(j.genres);
  const synopsis = await translateToId(j.synopsis || '');
  const payload = {
    id: existingId || undefined,
    title: j.title,
    title_jp: j.title_japanese || j.title,
    alt_titles: [j.title_english].filter(Boolean),
    synopsis,
    genre: genre.join(', '),
    rating: j.score ? String(j.score) : '0',
    aired_from: airedFrom,
    aired_to: airedTo,
    type: j.type || 'TV',
    status: j.statusNorm || j.status || 'ongoing',
    featured: false,
    trending: false,
    poster: '',
    gdrive_links: '',
  };
  const r = await fetch(MAHI + '/api/admin/anime', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
    body: JSON.stringify(payload),
  });
  const d = await r.json();
  console.log('[ok] anime added via ' + src + ':', j.title, '->', r.status);
  if (notifyChat) await send(notifyChat, '[Bot] Request "' + j.title + '" sudah ditambahkan.\nSumber: ' + src + '\nGenre: ' + (genre.join(', ') || '-') + '\nRating: ' + (j.score || '-'));
  return d;
}

async function markRequestDone(id) {
  try {
    await fetch(MAHI + '/api/admin/requests/' + id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify({ status: 'done' }),
    });
  } catch (e) {
    console.error('[err] markRequestDone', e.message);
  }
}

async function pollRequests() {
  try {
    const r = await fetch(MAHI + '/api/requests?limit=50');
    const d = await r.json();
    const list = d.data || d.requests || [];
    for (const req of list) {
       if (req.status === 'done') continue;
      if (Date.now() - lastRequestPoll < 1000) continue;
      const name = req.title || req.anime || '';
      if (!name) continue;
      console.log('[bot] processing web request:', name);
      await addAnimeFromJikan(name, ownerChat || (req.user_id ? '' : ''));
      await markRequestDone(req.id);
    }
    lastRequestPoll = Date.now();
  } catch (e) {
    console.error('[err] pollRequests', e.message);
  }
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (MahiStream Bot)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadToFile(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      const ct = (res.headers['content-type'] || '').toLowerCase();
      if (ct.includes('text/html')) {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const html = Buffer.concat(chunks).toString('utf8');
          if (html.includes('Quota exceeded') || html.includes('Too many users')) reject(new Error('Quota Exceeded'));
          else if (html.includes('Virus scan')) reject(new Error('Virus scan confirm required'));
          else reject(new Error('Got HTML'));
        });
        return;
      }
      const file = createWriteStream(dest);
      let total = 0;
      res.on('data', c => { total += c.length; });
      res.pipe(file);
      file.on('finish', () => { file.close(() => resolve({ size: total, contentType: ct })); });
      file.on('error', (e) => { reject(e); });
    });
    req.on('error', reject);
    req.setTimeout(600000, () => { req.destroy(new Error('Download timeout')); });
  });
}

async function syncOngoingStatus() {
  try {
    if (Date.now() - lastStatusSync < 3600000) return;
    lastStatusSync = Date.now();
    const r = await fetch(MAHI + '/api/anime?limit=1000');
    const d = await r.json();
    const list = Array.isArray(d) ? d : (d.animeList || d.data || []);
    let updated = 0;
    for (const a of list) {
      if (a.status !== 'ongoing') continue;
      const j = await anilistSearch(a.title).catch(() => null);
      if (j && j.statusNorm === 'complete') {
        await fetch(MAHI + '/api/admin/anime', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
          body: JSON.stringify({ id: a.id, title: a.title, status: 'completed' })
        });
        if (ownerChat) {
          await send(ownerChat, '[Bot] Auto-update: "' + a.title + '" -> completed (Finished Airing per AniList).');
        }
        updated++;
        await new Promise(res => setTimeout(res, 1500));
      }
    }
    if (updated > 0) console.log('[bot] syncOngoingStatus: ' + updated + ' anime marked completed');
  } catch (e) {
    console.error('[err] syncOngoingStatus', e.message);
  }
}

async function poll() {
  try {
    const r = await fetch(API + '/getUpdates?offset=' + (lastUpdate + 1) + '&timeout=30');
    const d = await r.json();
    if (d.ok) {
      for (const u of d.result) {
        lastUpdate = u.update_id;
        if (u.inline_query) {
          try {
            const q = u.inline_query.query.trim();
            const list = await getAnimeList();
            let results = [];
            if (q) {
              results = list.filter(a => {
                const t = (a.title + ' ' + (a.title_jp || '') + ' ' + normAlt(a.alt_titles).join(' ')).toLowerCase();
                return t.includes(q.toLowerCase());
              }).slice(0, 20);
            } else {
              results = list.slice().sort((a, b) => (b.views || b.rating || 0) - (a.views || a.rating || 0)).slice(0, 20);
            }
            const articles = results.map((a, i) => ({
              type: 'article',
              id: String(a.id || i),
              title: a.title,
              description: (a.genres || []).join(', ') + ' · ' + (a.status || 'ongoing') + (a.year ? ' · ' + a.year : ''),
              thumb_url: a.poster_url || '',
              input_message_content: {
                message_text: a.title + '\n' + (a.synopsis ? String(a.synopsis).slice(0, 200) + '...' : '') + '\n\nTonton: ' + BASE + '/anime/' + a.id,
              },
              reply_markup: { inline_keyboard: [[{ text: 'Tonton', url: BASE + '/anime/' + a.id }]] },
            }));
            await fetch(API + '/answerInlineQuery', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ inline_query_id: u.inline_query.id, results: articles, cache_time: 30 }),
            });
          } catch (e) { console.error('[err] inline', e.message); }
          continue;
        }
        const msg = u.channel_post || u.message;
        if (!msg) continue;
        if (MIGRATING && msg.forward_from_chat) continue;
        if (msg.chat && msg.chat.type === 'channel') {
          if (msg.video) await handleVideo(msg);
          else if (msg.document) await handleDocument(msg);
        }
        if (u.callback_query) {
          await handleCallback(u.callback_query);
          continue;
        }
        if (msg.chat && msg.chat.type === 'private') {
          if (msg.video) {
            await handleVideo(msg);
            continue;
          }
          if (msg.document) {
            const fn = (msg.document.file_name || '').toLowerCase();
            const mime = msg.document.mime_type || '';
            if (/\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v|ts)$/.test(fn) || mime.startsWith('video/')) {
              await handleDocument(msg);
            } else {
              await handleBatchFile(msg);
            }
            continue;
          }
        }
        if (msg.text && msg.chat.type === 'private') {
          if (!ownerChat) setOwnerChat(msg.chat.id);
          saveUser(msg.from.id, msg.from.username);
          const txt = msg.text.trim();
          const pend = pendingSinopsis.get(msg.chat.id);
          if (pend && txt.toLowerCase() !== 'batal' && !txt.toLowerCase().startsWith('sinopsis ') && !txt.startsWith('/')) {
            pendingSinopsis.delete(msg.chat.id);
            try {
              const r = await fetch(MAHI + '/api/admin/anime', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
                body: JSON.stringify({ id: pend.id, title: pend.title, synopsis: txt }),
              });
              await sendUser(msg.chat.id, '[Bot] Sinopsis "' + pend.title + '" disimpan (' + r.status + ', ' + txt.length + ' karakter).');
            } catch (e) {
              await sendUser(msg.chat.id, '[Bot] Gagal simpan sinopsis. Coba lagi.');
            }
            continue;
          }
          if (pend && txt.toLowerCase() === 'batal') {
            pendingSinopsis.delete(msg.chat.id);
            await sendUser(msg.chat.id, '[Bot] Input sinopsis dibatalkan.');
            continue;
          }
          if (txt.toLowerCase().startsWith('broadcast ')) {
            if (!isOwner(msg.from.id)) { await send(msg.chat.id, '[Bot] Akses ditolak. Hanya owner yang bisa broadcast.'); }
            else {
              const pesan = txt.slice(10).trim();
              if (pesan) {
                const users = loadUsers();
                let ok = 0;
                for (const u of users) { await send(u.id, '[Broadcast] ' + pesan); ok++; await new Promise((r) => setTimeout(r, 50)); }
                await send(msg.chat.id, '[Bot] Broadcast terkirim ke ' + ok + ' user.');
              }
            }
          } else if (txt.startsWith('/start')) {
            const greet = 'Halo! Saya Bot MahiStream\n\nSaya membantu kamu mengelola anime & episode langsung dari Telegram.\n\nCara pakai:\n• Kirim NAMA ANIME -> saya cari metadata (Jikan/AniList) & tambah otomatis\n• Upload VIDEO ke channel dengan caption "Judul eps 1 s1 reso 720p" -> saya buat episode\n• "request <nama>" -> saya proses request dari web\n• "update <nama>" -> perbarui data anime (status, sinopsis, dll)\n\nGunakan tombol di bawah untuk menu fitur. Ketik "menu" untuk lihat perintah.';
            await sendUser(msg.chat.id, greet);
          } else if (txt.toLowerCase() === 'menu') {
            const menu = 'MENU BOT MAHISTREAM\n\n' +
              '== ANIME ==\n' +
              '<nama anime> — cari & tambah anime baru (Jikan/AniList)\n' +
              'cari <judul> — cari anime di database\n' +
              'update <nama> — perbarui data anime\n' +
              'poster <judul> <url> — set poster anime\n' +
              'ep <judul> <nomor> — lihat link episode\n' +
              'random — anime acak dari database\n' +
              'top — anime terpopuler\n' +
              'genre <nama> — filter anime by genre\n' +
              '\n== EPISODE ==\n' +
              'Upload video ke channel dengan caption:\n' +
              '  "Judul eps 1 s1 reso 720p"\n' +
              '  (s1/s2 = season, reso = resolusi)\n' +
              'Upload .txt (batch): add/update/request per baris\n' +
              '\n== REQUEST ==\n' +
              'request <nama> — tambah dari request web\n' +
              'cek req — daftar request + tombol status\n' +
              'req <id> <pending|process|done> — ubah status\n' +
              'del req <id> — hapus request\n' +
              '\n== FAVORIT ==\n' +
              'favorit — lihat daftar favorit\n' +
              'favorit <judul> — tambah ke favorit\n' +
              '\n== SUBSCRIBE ==\n' +
              'subscribe <judul> — notifikasi episode baru\n' +
              'unsubscribe <judul> — berhenti notifikasi\n' +
              'mysubs — lihat daftar subscribe\n' +
              '\n== WATCHLIST & HISTORY ==\n' +
              'watchlist — lihat watchlist kamu\n' +
              'add <judul> — tambah ke watchlist\n' +
              'last — 5 tontonan terakhir\n' +
              '\n== INFO ==\n' +
              'stats — statistik (total anime/request)\n' +
              'help — bantuan lengkap\n' +
              'menu — tampilkan menu ini\n' +
              '\n== OWNER ONLY ==\n' +
              'broadcast <pesan> — kirim ke semua user\n' +
              'cekbolong — deteksi anime episode bolong';
            await sendUser(msg.chat.id, menu);
          } else if (txt.toLowerCase().startsWith('request ')) {
            const name = txt.slice(8).trim();
            if (name) {
              await send(msg.chat.id, '[Bot] Memproses request: ' + name);
              await addAnimeFromJikan(name, String(msg.chat.id));
            }
          } else if (txt.toLowerCase().startsWith('update ')) {
            const name = txt.slice(7).trim();
            if (name) {
              const list = await getAnimeList();
              const found = matchAnime(list, name);
              if (!found) {
                await send(msg.chat.id, '[Bot] Anime "' + name + '" tidak ditemukan di database. Menambahkan baru...');
                await addAnimeFromJikan(name, String(msg.chat.id));
              } else {
                await send(msg.chat.id, '[Bot] Memperbarui "' + found.title + '"...');
                await addAnimeFromJikan(name, String(msg.chat.id), found.id);
              }
            }
          } else if (txt.toLowerCase() === 'cek req' || txt.toLowerCase() === 'request list') {
            try {
              const rr = await fetch(MAHI + '/api/requests?limit=50');
              const rd = await rr.json();
              const list = Array.isArray(rd) ? rd : (rd.data || rd.requests || []);
              if (!list.length) {
                await send(msg.chat.id, '[Bot] Tidak ada request masuk.');
              } else {
                const lines = list.map((x, i) => (i + 1) + '. #' + x.id + ' ' + (x.title || x.anime || '-') + ' [' + (x.status || 'pending') + ']');
                const keyboard = {
                  inline_keyboard: list.slice(0, 10).map(x => ([
                    { text: '✅ ' + x.id + ' done', callback_data: 'req:' + x.id + ':done' },
                    { text: '⏳ ' + x.id + ' process', callback_data: 'req:' + x.id + ':process' },
                  ])),
                };
                await send(msg.chat.id, '[Bot] Daftar Request:\n' + lines.join('\n'), { reply_markup: keyboard });
              }
            } catch (e) {
              await send(msg.chat.id, '[Bot] Gagal mengambil request.');
            }
          } else if (txt.toLowerCase().startsWith('req ')) {
            const parts = txt.slice(4).trim().split(/\s+/);
            const rid = parts[0];
            const st = (parts[1] || '').toLowerCase();
            if (rid && ['pending', 'process', 'done'].includes(st)) {
              await changeReqStatus(msg.chat.id, rid, st);
            } else {
              await send(msg.chat.id, '[Bot] Format: req <id> <pending|process|done>');
            }
          } else if (txt.toLowerCase().startsWith('del req ')) {
            const rid = txt.slice(8).trim();
            if (rid) {
              try {
                const dr = await fetch(MAHI + '/api/admin/requests/' + rid, {
                  method: 'DELETE',
                  headers: { 'x-admin-key': ADMIN_KEY },
                });
                await send(msg.chat.id, '[Bot] Request #' + rid + ' dihapus (' + dr.status + ')');
              } catch (e) {
                await send(msg.chat.id, '[Bot] Gagal menghapus request.');
              }
            }
          } else if (txt.toLowerCase() === 'stats') {
            try {
              const ar = await fetch(MAHI + '/api/anime?limit=1');
              const ad = await ar.json();
              const totalAnime = (ad.animeList || ad.data || []).length ? (ad.total || ad.animeList.length) : 0;
              const rr = await fetch(MAHI + '/api/requests?limit=50');
              const rd = await rr.json();
              const reqs = Array.isArray(rd) ? rd : (rd.data || rd.requests || []);
              const pending = reqs.filter(x => (x.status || 'pending') !== 'done').length;
              await send(msg.chat.id, '[Bot] Statistik:\n• Total anime: ' + totalAnime + '\n• Request masuk: ' + reqs.length + '\n• Request belum selesai: ' + pending);
            } catch (e) {
              await send(msg.chat.id, '[Bot] Gagal mengambil statistik.');
            }
          } else if (txt.toLowerCase() === 'cekbolong' || txt.toLowerCase() === 'bolong' || txt.toLowerCase() === 'audit eps') {
            if (!isOwner(msg.from.id)) {
              await send(msg.chat.id, '[Bot] Akses ditolak. Hanya owner yang bisa cek episode bolong.');
            } else {
              await send(msg.chat.id, '[Bot] Memindai semua anime untuk episode bolong... (mohon tunggu)');
              try {
                const rep = await detectGaps();
                if (!rep.length) {
                  await send(msg.chat.id, '[Bot] Semua anime lengkap, tidak ada episode bolong.');
                } else {
                  const W = { no: 4, title: 40, ep: 5, maks: 5, hilang: 16 };
                  const pad = (s, w) => String(s).slice(0, w).padEnd(w);
                  const sep = '-'.repeat(W.no) + '+-' + '-'.repeat(W.title) + '-+-' + '-'.repeat(W.ep) + '-+-' + '-'.repeat(W.maks) + '-+-' + '-'.repeat(W.hilang);
                  const tlines = [pad('No', W.no) + '| ' + pad('Anime', W.title) + '| ' + pad('Ep', W.ep) + '| ' + pad('Maks', W.maks) + '| ' + pad('Hilang', W.hilang), sep];
                  rep.forEach((x, i) => {
                    const t = x.title.length > W.title ? x.title.slice(0, W.title - 1) + '\u2026' : x.title;
                    tlines.push(pad(i + 1, W.no) + '| ' + pad(t, W.title) + '| ' + pad(x.count, W.ep) + '| ' + pad(x.max, W.maks) + '| ' + pad(x.missing.join(', '), W.hilang));
                  });
                  tlines.push(sep);
                  const tbl = '<pre>' + escHtml(tlines.join('\n')) + '</pre>';
                  await sendChunks(msg.chat.id, '[Bot] Ditemukan ' + rep.length + ' anime dengan episode bolong:\n' + tbl, { parse_mode: 'HTML' });
                }
              } catch (e) {
                await send(msg.chat.id, '[Bot] Gagal memindai: ' + (e.message || e));
              }
            }
          } else if (txt.toLowerCase().startsWith('cari ')) {
            const q = txt.slice(5).trim();
            if (q) {
              const list = await getAnimeList();
              const found = list.filter(a => {
                const t = (a.title + ' ' + (a.title_jp || '') + ' ' + normAlt(a.alt_titles).join(' ')).toLowerCase();
                return t.includes(q.toLowerCase());
              }).slice(0, 10);
              if (!found.length) await send(msg.chat.id, '[Bot] Tidak ada anime cocok dengan "' + q + '".');
              else await send(msg.chat.id, '[Bot] Hasil cari:\n' + found.map((a, i) => (i + 1) + '. ' + a.title + ' [' + (a.status || 'ongoing') + ']').join('\n'));
            }
          } else if (txt.toLowerCase().startsWith('ep ')) {
            const parts = txt.slice(3).trim().split(/\s+/);
            const q = parts.slice(0, -1).join(' ');
            const num = parseInt(parts[parts.length - 1]);
            if (q && num) {
              const list = await getAnimeList();
              const anime = matchAnime(list, q);
              if (!anime) { await send(msg.chat.id, '[Bot] Anime tidak ditemukan.'); }
              else {
                const er = await fetch(MAHI + '/api/episodes/' + anime.id);
                const ed = await er.json();
                const eps = ed.episodeList || ed.data || [];
                const ep = eps.find(e => e.number === num);
                if (!ep) await send(msg.chat.id, '[Bot] Episode ' + num + ' tidak ditemukan.');
                else {
                  let links = [];
                  try { links = JSON.parse(ep.gdrive_links || '[]'); } catch (e) {}
                  const url = links.length ? links[0].url : '-';
                  await send(msg.chat.id, '[Bot] ' + anime.title + ' Episode ' + num + ':\n' + url);
                }
              }
            } else {
              await send(msg.chat.id, '[Bot] Format: ep <judul> <nom>');
            }
          } else if (txt.toLowerCase().startsWith('poster ')) {
            const rest = txt.slice(7).trim();
            const sp = rest.lastIndexOf(' ');
            if (sp > 0) {
              const name = rest.slice(0, sp).trim();
              const url = rest.slice(sp + 1).trim();
              const list = await getAnimeList();
              const anime = matchAnime(list, name);
              if (!anime) await send(msg.chat.id, '[Bot] Anime tidak ditemukan.');
              else {
                try {
                  const pr = await fetch(MAHI + '/api/admin/anime', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
                    body: JSON.stringify({ id: anime.id, poster: url }),
                  });
                  await send(msg.chat.id, '[Bot] Poster "' + anime.title + '" diperbarui (' + pr.status + ')');
                } catch (e) {
                  await send(msg.chat.id, '[Bot] Gagal set poster.');
                }
              }
            } else {
              await send(msg.chat.id, '[Bot] Format: poster <judul> <url>');
            }
          } else if (txt.toLowerCase() === 'help' || txt.toLowerCase() === '/help') {
            const help = 'BANTUAN MAHISTREAM BOT\n\n' +
              'Perintah dasar:\n' +
              '• <nama anime> — cari & tambah anime\n' +
              '• request <nama> — proses request dari web\n' +
              '• update <nama> — perbarui data anime\n' +
              '• cek req — daftar request\n' +
              '• req <id> <status> — ubah status request\n' +
              '• del req <id> — hapus request\n' +
              '• stats — statistik bot\n' +
              '• cari <judul> — cari anime\n' +
              '• ep <judul> <nom> — link episode\n' +
              '• poster <judul> <url> — set poster\n' +
              '• menu — lihat semua perintah\n' +
              '• help — bantuan ini\n\n' +
              'Owner only:\n' +
              '• broadcast <pesan> — kirim ke semua user';
            await sendUser(msg.chat.id, help);
          } else if (txt === 'Cari' || txt.toLowerCase() === 'cari') {
            await sendUser(msg.chat.id, '[Bot] Ketik: cari <judul>  (contoh: cari Naruto)');
          } else if (txt === 'Stats' || txt.toLowerCase() === 'stats') {
            try {
              const ar = await fetch(MAHI + '/api/anime?limit=1');
              const ad = await ar.json();
              const totalAnime = (ad.animeList || ad.data || []).length ? (ad.total || ad.animeList.length) : 0;
              const rr = await fetch(MAHI + '/api/requests?limit=50');
              const rd = await rr.json();
              const reqs = Array.isArray(rd) ? rd : (rd.data || rd.requests || []);
              const pending = reqs.filter(x => (x.status || 'pending') !== 'done').length;
              await sendUser(msg.chat.id, '[Bot] Statistik:\n• Total anime: ' + totalAnime + '\n• Request masuk: ' + reqs.length + '\n• Request belum selesai: ' + pending);
            } catch (e) {
              await sendUser(msg.chat.id, '[Bot] Gagal mengambil statistik.');
            }
          } else if (txt === 'Random' || txt.toLowerCase() === 'random') {
            try {
              const list = await getAnimeList();
              if (!list.length) await sendUser(msg.chat.id, '[Bot] Database kosong.');
              else {
                const a = list[Math.floor(Math.random() * list.length)];
                await sendUser(msg.chat.id, '[Bot] Random: ' + a.title + ' [' + (a.status || 'ongoing') + ']\n' + (a.synopsis ? String(a.synopsis).slice(0, 200) + '...' : ''));
              }
            } catch (e) {
              await sendUser(msg.chat.id, '[Bot] Gagal mengambil random.');
            }
          } else if (txt === 'Top' || txt.toLowerCase() === 'top') {
            try {
              const list = await getAnimeList();
              const sorted = list.slice().sort((a, b) => (b.views || b.rating || 0) - (a.views || a.rating || 0)).slice(0, 10);
              if (!sorted.length) await sendUser(msg.chat.id, '[Bot] Database kosong.');
              else await sendUser(msg.chat.id, '[Bot] Top Anime:\n' + sorted.map((a, i) => (i + 1) + '. ' + a.title).join('\n'));
            } catch (e) {
              await sendUser(msg.chat.id, '[Bot] Gagal mengambil top.');
            }
          } else if (txt === 'Favorit' || txt.toLowerCase().startsWith('favorit')) {
            try {
              const favs = loadFavorites(msg.chat.id);
              if (!favs.length) await sendUser(msg.chat.id, '[Bot] Belum ada favorit. Tambah dengan: favorit <judul>');
              else {
                const list = await getAnimeList();
                const names = favs.map(id => { const a = list.find(x => String(x.id) === String(id)); return a ? a.title : '#' + id; });
                await sendUser(msg.chat.id, '[Bot] Favorit kamu:\n' + names.map((n, i) => (i + 1) + '. ' + n).join('\n'));
              }
            } catch (e) {
              await sendUser(msg.chat.id, '[Bot] Gagal mengambil favorit.');
            }
          } else if (txt === 'Genre' || txt.toLowerCase().startsWith('genre ')) {
            const g = txt.toLowerCase().startsWith('genre ') ? txt.slice(6).trim() : '';
            try {
              const list = await getAnimeList();
              const found = list.filter(a => {
                const gs = (a.genres || []).join(' ').toLowerCase();
                return g ? gs.includes(g.toLowerCase()) : (a.genres && a.genres.length);
              }).slice(0, 10);
              if (!found.length) await sendUser(msg.chat.id, '[Bot] Tidak ada anime dengan genre "' + g + '".');
              else await sendUser(msg.chat.id, '[Bot] Genre ' + (g || 'semua') + ':\n' + found.map((a, i) => (i + 1) + '. ' + a.title + ' [' + (a.genres || []).join(', ') + ']').join('\n'));
            } catch (e) {
              await sendUser(msg.chat.id, '[Bot] Gagal filter genre.');
            }
          } else if (txt.toLowerCase().startsWith('favorit ')) {
            const name = txt.slice(8).trim();
            const list = await getAnimeList();
            const anime = matchAnime(list, name);
            if (!anime) await sendUser(msg.chat.id, '[Bot] Anime "' + name + '" tidak ditemukan.');
            else {
              const added = addFavorite(msg.chat.id, anime.id);
              const favs = loadFavorites(msg.chat.id);
              await sendUser(msg.chat.id, '[Bot] "' + anime.title + '" ' + (added ? 'ditambah ke' : 'sudah ada di') + ' favorit (' + favs.length + ' total).');
            }
          } else if (txt.toLowerCase().startsWith('edit ep ')) {
            const rest = txt.slice(8).trim();
            const sp1 = rest.lastIndexOf(' ');
            if (sp1 > 0) {
              const url = rest.slice(sp1 + 1).trim();
              const head = rest.slice(0, sp1).trim();
              const sp2 = head.lastIndexOf(' ');
              if (sp2 > 0 && url) {
                const name = head.slice(0, sp2).trim();
                const num = parseInt(head.slice(sp2 + 1));
                if (name && num) {
                  const list = await getAnimeList();
                  const anime = matchAnime(list, name);
                  if (!anime) await sendUser(msg.chat.id, '[Bot] Anime tidak ditemukan.');
                  else {
                    try {
                      const r = await fetch(MAHI + '/api/admin/episodes', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
                        body: JSON.stringify({ anime_id: anime.id, number: num, gdrive_links: JSON.stringify([{ label: '720p', url }]) }),
                      });
                      const d = await r.json();
                      await sendUser(msg.chat.id, '[Bot] Episode ' + num + ' "' + anime.title + '" diupdate.\n' + url + ' (' + (d.message || r.status) + ')');
                    } catch (e) {
                      await sendUser(msg.chat.id, '[Bot] Gagal update episode.');
                    }
                  }
                } else await sendUser(msg.chat.id, '[Bot] Format: edit ep <judul> <nom> <url>');
              } else await sendUser(msg.chat.id, '[Bot] Format: edit ep <judul> <nom> <url>');
            } else await sendUser(msg.chat.id, '[Bot] Format: edit ep <judul> <nom> <url>');
          } else if (txt.toLowerCase().startsWith('del ep ')) {
            const rest = txt.slice(7).trim();
            const sp = rest.lastIndexOf(' ');
            if (sp > 0) {
              const name = rest.slice(0, sp).trim();
              const num = parseInt(rest.slice(sp + 1));
              if (name && num) {
                const list = await getAnimeList();
                const anime = matchAnime(list, name);
                if (!anime) await sendUser(msg.chat.id, '[Bot] Anime tidak ditemukan.');
                else {
                  try {
                    const er = await fetch(MAHI + '/api/episodes/' + anime.id);
                    const ed = await er.json();
                    const eps = ed.episodeList || ed.data || [];
                    const ep = eps.find(e => e.number === num);
                    if (!ep) await sendUser(msg.chat.id, '[Bot] Episode ' + num + ' tidak ditemukan.');
                    else {
                      const dr = await fetch(MAHI + '/api/admin/episodes/' + ep.id, {
                        method: 'DELETE',
                        headers: { 'x-admin-key': ADMIN_KEY },
                      });
                      await sendUser(msg.chat.id, '[Bot] Episode ' + num + ' "' + anime.title + '" dihapus (' + dr.status + ').');
                    }
                  } catch (e) {
                    await sendUser(msg.chat.id, '[Bot] Gagal hapus episode.');
                  }
                }
              } else await sendUser(msg.chat.id, '[Bot] Format: del ep <judul> <nom>');
            } else await sendUser(msg.chat.id, '[Bot] Format: del ep <judul> <nom>');
          } else if (txt.toLowerCase().startsWith('cache ')) {
            const rest = txt.slice(6).trim();
            const sp = rest.lastIndexOf(' ');
            if (sp > 0) {
              const name = rest.slice(0, sp).trim();
              const num = parseInt(rest.slice(sp + 1));
              if (name && num) {
                const list = await getAnimeList();
                const anime = matchAnime(list, name);
                if (!anime) await sendUser(msg.chat.id, '[Bot] Anime tidak ditemukan.');
                else {
                  try {
                    const er = await fetch(MAHI + '/api/episodes/' + anime.id);
                    const ed = await er.json();
                    const eps = ed.episodeList || ed.data || [];
                    const ep = eps.find(e => e.number === num);
                    if (!ep) await sendUser(msg.chat.id, '[Bot] Episode ' + num + ' tidak ditemukan.');
                    else {
                      let links = ep.gdrive_links;
                      if (typeof links === 'string') { try { links = JSON.parse(links); } catch (_) { links = []; } }
                      if (!Array.isArray(links) || links.length === 0) {
                        await sendUser(msg.chat.id, '[Bot] Episode tidak punya link gdrive.');
                      } else {
                        const u = links[0].url || '';
                        let gid = null;
                        let m = u.match(/\/api\/gdrive\/([^/?]+)/);
                        if (m) gid = m[1];
                        if (!gid) { m = u.match(/[?&]id=([^&]+)/); if (m) gid = m[1]; }
                        if (!gid) { m = u.match(/\/d\/([^/?]+)/); if (m) gid = m[1]; }
                        if (!gid) {
                          await sendUser(msg.chat.id, '[Bot] Tidak bisa ekstrak Google Drive ID dari link.');
                        } else {
                          await sendUser(msg.chat.id, '[Bot] Mulai download "' + anime.title + '" ep ' + num + ' dari Google Drive. Tunggu beberapa menit...');
                          const dest = path.join(DATA_DIR, 'videos', anime.id + '-ep' + num + '.mp4');
                          const dlUrl = 'https://drive.usercontent.google.com/download?id=' + gid + '&export=download&authuser=0&confirm=t';
                          try {
                            const info = await downloadToFile(dlUrl, dest);
                            const mb = (info.size / 1048576).toFixed(1);
                            const newUrl = '/videos/' + anime.id + '-ep' + num + '.mp4';
                            const label = links[0].label || '1080p';
                            await fetch(MAHI + '/api/admin/episodes', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
                              body: JSON.stringify({ anime_id: anime.id, number: num, gdrive_links: JSON.stringify([{ label: label, url: newUrl }]) }),
                            });
                            await sendUser(msg.chat.id, '[Bot] Cache selesai. "' + anime.title + '" ep ' + num + ' (' + mb + ' MB). Stream: ' + BASE + newUrl);
                          } catch (e) {
                            await sendUser(msg.chat.id, '[Bot] Download gagal: ' + e.message + '. Jika Quota Exceeded, tunggu 24 jam lalu coba lagi.');
                          }
                        }
                      }
                    }
                  } catch (e) {
                    await sendUser(msg.chat.id, '[Bot] Gagal cache episode.');
                  }
                }
              } else await sendUser(msg.chat.id, '[Bot] Format: cache <judul> <nom>');
            } else await sendUser(msg.chat.id, '[Bot] Format: cache <judul> <nom>');
          } else if (txt.toLowerCase() === 'terbaru') {
            try {
              const r = await fetch(MAHI + '/api/anime?limit=10');
              const d = await r.json();
              const list = d.animeList || d.data || [];
              if (!list.length) await sendUser(msg.chat.id, '[Bot] Belum ada anime.');
              else await sendUser(msg.chat.id, '[Bot] Anime terbaru:\n' + list.map((a, i) => (i + 1) + '. ' + a.title + ' [' + (a.status || 'ongoing') + ']').join('\n'));
            } catch (e) {
              await sendUser(msg.chat.id, '[Bot] Gagal ambil terbaru.');
            }
          } else if (txt.toLowerCase().startsWith('approve ')) {
            const rid = txt.slice(8).trim();
            if (rid) {
              try {
                const rr = await fetch(MAHI + '/api/requests?limit=100');
                const rd = await rr.json();
                const reqs = Array.isArray(rd) ? rd : (rd.data || rd.requests || []);
                const req = reqs.find(x => String(x.id) === String(rid));
                if (!req) await sendUser(msg.chat.id, '[Bot] Request #' + rid + ' tidak ditemukan.');
                else {
                  await sendUser(msg.chat.id, '[Bot] Approve request #' + rid + ' "' + (req.title || req.anime) + '" — mengambil dari Jikan...');
                  await addAnimeFromJikan(req.title || req.anime, String(msg.chat.id));
                  await fetch(MAHI + '/api/admin/requests/' + rid, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
                    body: JSON.stringify({ status: 'done' }),
                  });
                  await sendUser(msg.chat.id, '[Bot] Request #' + rid + ' diapprove & ditandai done.');
                }
              } catch (e) {
                await sendUser(msg.chat.id, '[Bot] Gagal approve.');
              }
            } else await sendUser(msg.chat.id, '[Bot] Format: approve <id>');
          } else if (txt.toLowerCase().startsWith('tolak ')) {
            const rest = txt.slice(6).trim();
            const sp = rest.indexOf(' ');
            const rid = sp > 0 ? rest.slice(0, sp).trim() : rest.trim();
            const alasan = sp > 0 ? rest.slice(sp + 1).trim() : '';
            if (rid) {
              try {
                await fetch(MAHI + '/api/admin/requests/' + rid, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
                  body: JSON.stringify({ status: 'rejected' }),
                });
                await sendUser(msg.chat.id, '[Bot] Request #' + rid + ' ditolak.' + (alasan ? ' Alasan: ' + alasan : ''));
              } catch (e) {
                await sendUser(msg.chat.id, '[Bot] Gagal tolak.');
              }
            } else await sendUser(msg.chat.id, '[Bot] Format: tolak <id> [alasan]');
          } else if (txt.toLowerCase() === 'backup') {
            try {
              const ar = await fetch(MAHI + '/api/anime?limit=1000');
              const ad = await ar.json();
              const animes = ad.animeList || ad.data || [];
              const allEps = [];
              for (const a of animes) {
                const er = await fetch(MAHI + '/api/episodes/' + a.id);
                const ed = await er.json();
                const eps = ed.episodeList || ed.data || [];
                allEps.push(...eps);
              }
              const fs = await import('node:fs');
              const fname = path.join(DATA_DIR, 'backup-' + new Date().toISOString().slice(0, 10) + '.json');
              fs.writeFileSync(fname, JSON.stringify({ date: new Date().toISOString(), animes, episodes: allEps }, null, 2));
              await sendUser(msg.chat.id, '[Bot] Backup selesai: ' + fname + '\nTotal: ' + animes.length + ' anime, ' + allEps.length + ' episode.');
            } catch (e) {
              await sendUser(msg.chat.id, '[Bot] Gagal backup: ' + e.message);
            }
          } else if (txt.toLowerCase().startsWith('status ')) {
            const rest = txt.slice(7).trim();
            const sp = rest.lastIndexOf(' ');
            if (sp > 0) {
              const name = rest.slice(0, sp).trim();
              const st = rest.slice(sp + 1).trim().toLowerCase();
              if (['ongoing', 'completed', 'hiatus'].includes(st)) {
                const list = await getAnimeList();
                const anime = matchAnime(list, name);
                if (!anime) await sendUser(msg.chat.id, '[Bot] Anime tidak ditemukan.');
                else {
                  try {
                    const r = await fetch(MAHI + '/api/admin/anime', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
                      body: JSON.stringify({ id: anime.id, title: anime.title, status: st }),
                    });
                    await sendUser(msg.chat.id, '[Bot] Status "' + anime.title + '" -> ' + st + ' (' + r.status + ').');
                  } catch (e) {
                    await sendUser(msg.chat.id, '[Bot] Gagal set status.');
                  }
                }
              } else await sendUser(msg.chat.id, '[Bot] Status: ongoing | completed | hiatus');
            } else await sendUser(msg.chat.id, '[Bot] Format: status <judul> <ongoing|completed|hiatus>');
          } else if (txt.toLowerCase().startsWith('sinopsis ')) {
            const rest = txt.slice(9).trim();
            const sp = rest.indexOf(' ');
            const name = sp > 0 ? rest.slice(0, sp).trim() : rest.trim();
            const syn = sp > 0 ? rest.slice(sp + 1).trim() : '';
            if (!name) {
              await sendUser(msg.chat.id, '[Bot] Format:\n• sinopsis <judul> -> input multi-line (lengkap)\n• sinopsis <judul> <teks singkat> -> input sebaris\nKirim "batal" untuk membatalkan mode input.');
            } else {
              const list = await getAnimeList();
              const anime = matchAnime(list, name);
              if (!anime) await sendUser(msg.chat.id, '[Bot] Anime tidak ditemukan.');
              else if (syn) {
                try {
                  const r = await fetch(MAHI + '/api/admin/anime', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
                    body: JSON.stringify({ id: anime.id, title: anime.title, synopsis: syn }),
                  });
                  await sendUser(msg.chat.id, '[Bot] Sinopsis "' + anime.title + '" diupdate (' + r.status + ').');
                } catch (e) {
                  await sendUser(msg.chat.id, '[Bot] Gagal set sinopsis.');
                }
              } else {
                pendingSinopsis.set(msg.chat.id, { id: anime.id, title: anime.title });
                await sendUser(msg.chat.id, '[Bot] Mode input sinopsis untuk "' + anime.title + '".\nKirim teks sinopsis lengkap (boleh multi-line). Kirim "batal" untuk membatalkan.');
              }
            }
          } else if (txt.toLowerCase() === 'uptime') {
            const up = process.uptime();
            const h = Math.floor(up / 3600);
            const m = Math.floor((up % 3600) / 60);
            const s = Math.floor(up % 60);
            await sendUser(msg.chat.id, '[Bot] Uptime: ' + h + 'j ' + m + 'm ' + s + 'd');
          } else if (txt.toLowerCase().startsWith('maintenance ')) {
            const st = txt.slice(12).trim().toLowerCase();
            if (st === 'on' || st === 'off') {
              try {
                const fs = await import('node:fs');
                fs.writeFileSync(path.join(DATA_DIR, 'maintenance.txt'), st);
                await sendUser(msg.chat.id, '[Bot] Maintenance mode: ' + st.toUpperCase());
              } catch (e) {
                await sendUser(msg.chat.id, '[Bot] Gagal set maintenance.');
              }
            } else await sendUser(msg.chat.id, '[Bot] Format: maintenance <on|off>');
          } else if (txt.toLowerCase().startsWith('subscribe ') || txt.toLowerCase().startsWith('/subscribe ')) {
            const name = txt.replace(/^\/?subscribe\s+/i, '').trim();
            if (!name) {
              await sendUser(msg.chat.id, '[Bot] Format: subscribe <judul anime>\nContoh: subscribe Horimiya');
            } else {
              const list = await getAnimeList();
              const anime = matchAnime(list, name);
              if (!anime) await sendUser(msg.chat.id, '[Bot] Anime "' + name + '" tidak ditemukan.');
              else {
                const added = addSubscriber(msg.chat.id, anime.id);
                const subs = loadSubscribers(msg.chat.id);
                await sendUser(msg.chat.id, '[Bot] "' + anime.title + '" ' + (added ? 'ditambah ke' : 'sudah ada di') + ' daftar subscribe (' + subs.length + ' total).\nKamu akan dapat notifikasi saat episode baru tayang.');
              }
            }
          } else if (txt.toLowerCase().startsWith('unsubscribe ') || txt.toLowerCase().startsWith('/unsubscribe ')) {
            const name = txt.replace(/^\/?unsubscribe\s+/i, '').trim();
            if (!name) {
              await sendUser(msg.chat.id, '[Bot] Format: unsubscribe <judul anime>');
            } else {
              const list = await getAnimeList();
              const anime = matchAnime(list, name);
              if (!anime) await sendUser(msg.chat.id, '[Bot] Anime "' + name + '" tidak ditemukan.');
              else {
                removeSubscriber(msg.chat.id, anime.id);
                const subs = loadSubscribers(msg.chat.id);
                await sendUser(msg.chat.id, '[Bot] "' + anime.title + '" dihapus dari subscribe (' + subs.length + ' tersisa).');
              }
            }
          } else if (txt.toLowerCase() === 'mysubs' || txt.toLowerCase() === '/mysubs') {
            const subs = loadSubscribers(msg.chat.id);
            if (!subs.length) await sendUser(msg.chat.id, '[Bot] Belum ada subscribe. Tambah dengan: subscribe <judul>');
            else {
              const list = await getAnimeList();
              const names = subs.map(id => { const a = list.find(x => String(x.id) === String(id)); return a ? a.title : '#' + id; });
              await sendUser(msg.chat.id, '[Bot] Subscribe kamu:\n' + names.map((n, i) => (i + 1) + '. ' + n).join('\n'));
            }
          } else if (txt.toLowerCase() === 'watchlist' || txt.toLowerCase() === '/watchlist' || txt.toLowerCase() === 'wl') {
            try {
              const r = await fetch(MAHI + '/api/watchlist/tg_' + msg.chat.id);
              const d = await r.json();
              const items = Array.isArray(d) ? d : (d.items || []);
              if (!items.length) await sendUser(msg.chat.id, '[Bot] Watchlist kosong. Tambah dengan: add <judul>');
              else {
                const list = await getAnimeList();
                const lines = items.map(it => {
                  const a = list.find(x => String(x.id) === String(it.anime_id));
                  return (a ? a.title : '#' + it.anime_id) + ' [' + (it.status || '?') + ']';
                });
                await sendUser(msg.chat.id, '[Bot] Watchlist kamu:\n' + lines.map((n, i) => (i + 1) + '. ' + n).join('\n'));
              }
            } catch (e) { await sendUser(msg.chat.id, '[Bot] Gagal ambil watchlist.'); }
          } else if (txt.toLowerCase().startsWith('add ') || txt.toLowerCase().startsWith('/add ')) {
            const name = txt.replace(/^\/?add\s+/i, '').trim();
            if (!name) await sendUser(msg.chat.id, '[Bot] Format: add <judul anime>');
            else {
              const list = await getAnimeList();
              const anime = matchAnime(list, name);
              if (!anime) await sendUser(msg.chat.id, '[Bot] Anime "' + name + '" tidak ditemukan.');
              else {
                try {
                  await fetch(MAHI + '/api/watchlist/tg_' + msg.chat.id + '/' + anime.id, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'plan_to_watch' }),
                  });
                  await sendUser(msg.chat.id, '[Bot] "' + anime.title + '" ditambah ke watchlist (plan_to_watch). Lihat di web: ' + BASE + '/anime/' + anime.id);
                } catch (e) { await sendUser(msg.chat.id, '[Bot] Gagal tambah watchlist.'); }
              }
            }
          } else if (txt.toLowerCase() === 'last' || txt.toLowerCase() === '/last' || txt.toLowerCase() === 'history') {
            try {
              const r = await fetch(MAHI + '/api/history?userId=tg_' + msg.chat.id);
              const d = await r.json();
              const items = (Array.isArray(d) ? d : []).slice(0, 5);
              if (!items.length) await sendUser(msg.chat.id, '[Bot] Belum ada riwayat tonton.');
              else {
                const lines = items.map(it => {
                  const t = it.title || '#' + (it.anime_id || '');
                  return (it.episode ? 'EP ' + it.episode + ' ' : '') + t + (it.progress_seconds ? ' (' + Math.floor(it.progress_seconds / 60) + 'm)' : '');
                });
                await sendUser(msg.chat.id, '[Bot] 5 tontonan terakhir:\n' + lines.map((n, i) => (i + 1) + '. ' + n).join('\n'));
              }
            } catch (e) { await sendUser(msg.chat.id, '[Bot] Gagal ambil history.'); }
          } else if (txt.toLowerCase() === 'migrate-tg' || txt.toLowerCase() === '/migrate-tg') {
            if (String(msg.from.id) !== String(OWNER_CHAT)) { await send(msg.chat.id, '[Bot] Khusus owner.'); continue; }
            await migrateTgUrls(msg.chat.id);
          } else {
            await send(msg.chat.id, '[Bot] Mencari "' + txt + '"...');
            await addAnimeFromJikan(txt, String(msg.chat.id));
          }
        }
      }
    }
  } catch (e) {
    console.error('[err] poll', e.message);
  }
  setTimeout(poll, 1500);
}

async function changeReqStatus(chatId, rid, st) {
  try {
    const pr = await fetch(MAHI + '/api/admin/requests/' + rid, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify({ status: st }),
    });
    const pd = await pr.json();
    await send(chatId, '[Bot] Request #' + rid + ' -> status ' + st + ' (' + (pd.message || pr.status) + ')');
  } catch (e) {
    await send(chatId, '[Bot] Gagal mengubah status.');
  }
}

async function migrateTgUrls(chatId) {
  MIGRATING = true;
  try {
    await send(chatId, '[Migrate] Mulai migrasi URL telegram -> tg-stream...');
    const r = await fetch(MAHI + '/api/episodes');
    const eps = await r.json();
    const items = Array.isArray(eps) ? eps : (eps.items || []);
    let total = 0, ok = 0, fail = 0, skip = 0;
    for (const ep of items) {
      let raw = '';
      try { raw = JSON.parse(ep.gdrive_links || '[]')[0]?.url || ''; } catch {}
      if (!raw) { skip++; continue; }
      let chatIdRaw = '', msgIdRaw = '';
      const m1 = raw.match(/\/api\/telegram\/(-?\d+)\/(\d+)/);
      const m2 = raw.match(/t\.me\/c\/(\d+)\/(\d+)/);
      if (m1) { chatIdRaw = m1[1]; msgIdRaw = m1[2]; }
      else if (m2) { chatIdRaw = '-100' + m2[1]; msgIdRaw = m2[2]; }
      else { skip++; continue; }
      total++;
      try {
        const fwd = await fetch(API + '/forwardMessage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: OWNER_CHAT, from_chat_id: chatIdRaw, message_id: msgIdRaw }),
        });
        const fd = await fwd.json();
        if (!fd.ok) { fail++; console.log('[migrate] forwardMessage fail', fd.description); continue; }
        const fileId = fd.result?.video?.file_id || fd.result?.document?.file_id;
        if (!fileId) { fail++; continue; }
        const newUrl = BASE + '/api/telegram/' + chatIdRaw + '/' + msgIdRaw;
        await fetch(MAHI + '/api/admin/episodes', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
          body: JSON.stringify({ anime_id: ep.anime_id, number: ep.number, title: ep.title, gdrive_links: JSON.stringify([{ label: '1080p', url: newUrl }]) }),
        });
        await fetch(API + '/deleteMessage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: OWNER_CHAT, message_id: fd.result.message_id }),
        });
        ok++;
        if (ok % 10 === 0) await send(chatId, '[Migrate] ' + ok + '/' + total + ' selesai...');
        await new Promise(r => setTimeout(r, 200));
      } catch (e) { fail++; console.log('[migrate] err', e.message); }
    }
    await send(chatId, '[Migrate] Selesai! OK=' + ok + ' FAIL=' + fail + ' SKIP=' + skip + ' TOTAL=' + total);
  } finally {
    MIGRATING = false;
  }
}

async function saveEpisode(animeId, p) {
  const list = [...(await getAnimeList()), ...(await getKhususList())];
  const anime = list.find((a) => String(a.id) === String(animeId));
  const streamUrl = BASE + '/api/telegram/' + p.chatId + '/' + p.messageId;
  const saved = anime && anime.khusus ? await saveKhususEpisode(animeId, anime.title, p.parsed.num, p.parsed.res, streamUrl) : await saveAnimeEpisode(animeId, p.parsed.num, p.parsed.res, streamUrl);
  console.log('[ok ep-sel] saved for', anime ? anime.title : animeId, 'eps', p.parsed.num, '->', saved.status, saved.message || '');
  if (saved.dup) {
    const dupNotif = '[Bot] Episode ' + p.parsed.num + ' "' + (anime ? anime.title : animeId) + '" (' + p.parsed.res + ') sudah ada, dilewati.';
    if (p.chatId && !String(p.chatId).startsWith('-')) {
      await send(String(p.chatId), dupNotif);
      if (OWNER_CHAT && String(OWNER_CHAT) !== String(p.chatId)) await send(OWNER_CHAT, dupNotif);
    } else {
      if (OWNER_CHAT) await send(OWNER_CHAT, dupNotif);
    }
    return;
  }
  const notif = '[Bot] Episode ' + p.parsed.num + ' "' + (anime ? anime.title : animeId) + '" (' + p.parsed.res + ') berhasil ditambahkan.\n' + streamUrl;
  if (p.chatId && !String(p.chatId).startsWith('-')) {
    await send(String(p.chatId), notif);
    if (OWNER_CHAT && String(OWNER_CHAT) !== String(p.chatId)) await send(OWNER_CHAT, notif);
  } else {
    if (OWNER_CHAT) await send(OWNER_CHAT, notif);
  }
  if (p.chatId && String(p.chatId).startsWith('-')) await sendChannel(String(p.chatId), 'Episode ' + p.parsed.num + ' "' + (anime ? anime.title : animeId) + '" (' + p.parsed.res + ') sudah tersedia!\n' + streamUrl);
  await notifySubscribers(animeId, anime ? anime.title : animeId, p.parsed.num, streamUrl);
}

async function handleCallback(q) {
  try {
    const data = q.data || '';
    if (data.startsWith('req:')) {
      const [, rid, st] = data.split(':');
      await changeReqStatus(q.message.chat.id, rid, st);
      if (q.id) await fetch(API + '/answerCallbackQuery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: q.id, text: 'Status -> ' + st }),
      });
    } else if (data.startsWith('ep:')) {
      const parts = data.split(':');
      const animeId = parts[1];
      const key = parts.slice(2).join(':');
      const p = pendingEpisodes.get(key);
      if (p) {
        pendingEpisodes.delete(key);
        await saveEpisode(animeId, p);
        if (q.message && q.message.message_id) {
          await fetch(API + '/editMessageText', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: q.message.chat.id, message_id: q.message.message_id, text: '[Bot] ✅ Tersimpan ke anime #' + animeId + ' (Episode ' + p.parsed.num + ')' }),
          });
        }
        if (q.id) await fetch(API + '/answerCallbackQuery', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: q.id, text: 'Tersimpan' }),
        });
      }
    }
  } catch (e) {
    console.error('[err] callback', e.message);
  }
}

console.log('[bot] starting, BOTAPI=' + BOTAPI + ' LOCAL=' + LOCAL + ' OWNER=' + OWNER_CHAT);
poll();
setInterval(pollRequests, 15000);
setInterval(syncOngoingStatus, 6 * 3600 * 1000);
