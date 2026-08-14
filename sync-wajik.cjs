#!/usr/bin/env node
// sync-wajik.cjs — Sinkronisasi konten dari wajik-api (kuramanime/nekopoi/otakudesu) ke db.json
// Usage: node sync-wajik.cjs [kuramanime|nekopoi|otakudesu|all]
// Env:   WAJIK_API_URL (default http://127.0.0.1:3001), DB_PATH (default ./db.json),
//        SYNC_PAGE_LIMIT (default 30), SYNC_EP_LIMIT (default 0 = unlimited)
const fs = require("fs");
const path = require("path");

const WAJIK = (() => { const raw = (process.env.WAJIK_API_URL || "http://127.0.0.1:3001").trim(); return (/^https?:\/\//i.test(raw) ? raw : "https://" + raw).replace(/\/+$/, ""); })();
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "db.json");
const PAGE_LIMIT = parseInt(process.env.SYNC_PAGE_LIMIT || "30", 10);
const EP_LIMIT = parseInt(process.env.SYNC_EP_LIMIT || "0", 10);
const TIMEOUT_MS = parseInt(process.env.SYNC_TIMEOUT || "50000", 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...a) { console.log(new Date().toISOString(), ...a); }

async function jget(urlPath, tries = 3, wait = 3000) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const r = await fetch(WAJIK + urlPath, { signal: ctl.signal, headers: { accept: "application/json" } });
      clearTimeout(t);
      if (r.ok) { const j = await r.json(); return j; }
      if (r.status === 404) return null;
    } catch (e) { /* retry */ }
    if (i < tries - 1) await sleep(wait);
  }
  return null;
}

const MP4_RE = /\.(mp4|m3u8|webm)(\?|#|$)/i;
function isMp4(u) { return typeof u === "string" && MP4_RE.test(u); }
function streamProxy(url) { return `${WAJIK}/kuramanime/stream-proxy?url=${encodeURIComponent(url)}`; }
function iframeProxy(url) { return `${WAJIK}/kuramanime/iframe-proxy?url=${encodeURIComponent(url)}`; }
function nekoProxy(url) { return `${WAJIK}/nekopoi/iframe-proxy?url=${encodeURIComponent(url)}`; }
function otaProxy(url) { return `${WAJIK}/otakudesu/iframe-proxy?url=${encodeURIComponent(url)}`; }

// ── Kuramanime ───────────────────────────────────────────────────
const ADULT_RE = /(^|[^a-z0-9])(18\+|hentai|ecchi|oppai|uncensored|erotik|dewasa|smut|seinen)/i;

async function resolveKuraLink(det) {
  const cands = [];
  if (det?.defaultStreamingUrl) cands.push(det.defaultStreamingUrl);
  for (const s of (det?.serverList || [])) { const u = s?.url || s?.serverId; if (u) cands.push(u); }
  for (const q of (det?.downloadLinks || [])) { if (typeof q === "string") cands.push(q); else if (q?.url) cands.push(q.url); else for (const a of (q?.urls || [])) if (a?.url) cands.push(a.url); }
  for (const u of cands) {
    if (isMp4(u)) return { url: streamProxy(u), kind: "mp4" };
  }
  for (const u of cands) {
    const r = await jget(`/kuramanime/resolve-stream?serverId=${encodeURIComponent(u)}`, 2, 2000);
    const url = r?.data?.url;
    if (url && isMp4(url)) return { url: streamProxy(url), kind: "mp4" };
    if (url && /^https?:/.test(url)) return { url: iframeProxy(url), kind: "embed" };
  }
  return null;
}

async function syncKuramanime(DB) {
  const stats = { source: "kuramanime", pages: 0, anime: 0, episodes: 0, khusus: 0, failed: [] };
  let page = 1;
  const seen = new Set();
  while (page <= PAGE_LIMIT) {
    const r = await jget(`/kuramanime/latest?page=${page}`, 2, 4000);
    const list = r?.data?.animeList || [];
    if (!list.length) break;
    stats.pages++;
    log(`[kura] page ${page}: ${list.length} items`);
    for (const it of list) {
      const id = it.animeId || it.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const det = await jget(`/kuramanime/anime/${encodeURIComponent(id)}`);
      const d = det?.data?.details;
      if (!d || !(d.title || it.title)) { stats.failed.push("anime:" + id); continue; }
      const title = String(d.title || it.title).trim();
      const synopsis = Array.isArray(d.synopsis?.paragraphList) ? d.synopsis.paragraphList.join(" ") : String(d.synopsis || "");
      const genres = Array.isArray(d.genres) ? d.genres : [];
      const hay = (title + " " + synopsis + " " + genres.join(" ")).toLowerCase();
      const isAdult = ADULT_RE.test(hay);
      const eps = Array.isArray(d.episodeList) ? d.episodeList : [];
      if (EP_LIMIT > 0 && eps.length > EP_LIMIT) log(`[kura] ${id}: ${eps.length} eps, dibatasi ${EP_LIMIT}`);
      const epItems = EP_LIMIT > 0 ? eps.slice(0, EP_LIMIT) : eps;
      const epOut = [];
      for (const ep of epItems) {
        const epId = ep.episodeId || ep.id;
        if (!epId) continue;
        const ed = await jget(`/kuramanime/episode/${encodeURIComponent(epId)}`, 2, 3000);
        const edet = ed?.data?.details || ed?.data;
        let link = null;
        if (edet) link = await resolveKuraLink(edet);
        if (!link) { stats.failed.push("ep:" + epId); link = { url: "", kind: "none" }; }
        const num = parseInt(ep.number || String(epId).split("-").pop() || "1", 10) || 1;
        epOut.push({
          anime_id: id, number: num,
          title: String(ep.title || `Episode ${num}`),
          gdrive_links: JSON.stringify(link.url ? [{ url: link.url, label: link.kind === "mp4" ? "HD" : "Stream" }] : []),
          duration: 0, skip_intro: false, id: `${id}-${num}`, source: "kuramanime",
        });
      }
      const rating = parseFloat(d.score) || (it.score ? parseFloat(it.score) : 0) || 0;
      const animeObj = {
        id, slug: id, title,
        alt_titles: [], title_jp: d.title_jp || "",
        synopsis, genres, status: String(d.status || it.status || "Ongoing"),
        type: "TV", rating, aired_from: d.aired_from || "", aired_to: d.aired_to || "",
        episode_count: epOut.length, poster: d.poster || it.poster || "",
        created_at: new Date().toISOString(), source: "kuramanime", khusus: false,
      };
      if (isAdult) {
        DB.khusus = DB.khusus.filter(k => String(k.id) !== "kura-" + id);
        DB.khusus.push({
          id: "kura-" + id, title, poster: animeObj.poster, description: synopsis,
          gdrive_links: epOut.map((e) => ({ url: (JSON.parse(e.gdrive_links)[0] || {}).url || "", label: "HD", episode: e.number })),
        });
        stats.khusus++;
        log(`[kura] KHUSUS: ${title}`);
      } else {
        upsertAnime(DB, animeObj);
        DB.episodes = DB.episodes.filter(e => e.anime_id !== id).concat(epOut);
        stats.anime++;
        stats.episodes += epOut.length;
        log(`[kura] ${title} — ${epOut.length} eps${linkHits(epOut)}`);
      }
    }
    page++;
  }
  log(`[kura] done: pages=${stats.pages} anime=${stats.anime} eps=${stats.episodes} khusus=${stats.khusus} failed=${stats.failed.length}`);
  return stats;
}

function linkHits(epOut) {
  let ok = 0, none = 0;
  for (const e of epOut) {
    const arr = JSON.parse(e.gdrive_links || "[]");
    if (arr.length && arr[0].url) ok++; else none++;
  }
  return `(links ${ok}, kosong ${none})`;
}

// ── Nekopoi (semua → khusus) ─────────────────────────────────────
async function resolveNekoLink(serverId) {
  if (!serverId) return null;
  if (isMp4(serverId)) return { url: serverId, kind: "mp4" };
  const r = await jget(`/nekopoi/stream?serverId=${encodeURIComponent(serverId)}`, 2, 2500);
  const url = r?.data?.url;
  if (url && isMp4(url)) return { url, kind: "mp4" };
  if (url && /^https?:/.test(url)) return { url: nekoProxy(url), kind: "embed" };
  return null;
}

async function syncNekopoi(DB) {
  const stats = { source: "nekopoi", pages: 0, items: 0, khusus: 0, failed: [] };
  let page = 1;
  const seen = new Set();
  while (page <= PAGE_LIMIT) {
    const r = await jget(`/nekopoi/latest?page=${page}`, 2, 4000);
    const items = Array.isArray(r?.data) ? r.data : [];
    if (!items.length) break;
    stats.pages++;
    log(`[neko] page ${page}: ${items.length} items`);
    for (const it of items) {
      const id = it.id || it.slug;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const det = await jget(`/nekopoi/detail?url=${encodeURIComponent("https://nekopoi.care/" + id)}`, 2, 4000);
      const d = det?.data?.details || det?.data;
      if (!d || !(d.title || it.title)) { stats.failed.push("item:" + id); continue; }
      const title = String(d.title || it.title).trim();
      const streams = Array.isArray(d.streamLinks) ? d.streamLinks : [];
      const servers = Array.isArray(d.serverList) ? d.serverList : [];
      const first = streams[0]?.url || streams[0]?.serverId || servers[0]?.url || servers[0]?.serverId;
      let link = await resolveNekoLink(first);
      if (!link) { stats.failed.push("link:" + id); link = { url: "", kind: "none" }; }
      DB.khusus = DB.khusus.filter(k => String(k.id) !== "neko-" + id);
      DB.khusus.push({
        id: "neko-" + id, title, poster: d.image || it.image || "",
        description: String(d.synopsis || ""),
        gdrive_links: link.url ? [{ url: link.url, label: link.kind === "mp4" ? "HD" : "Stream", episode: 1 }] : [],
      });
      stats.khusus++;
      log(`[neko] KHUSUS: ${title} ${link.url ? "(link ok)" : "(tanpa link)"}`);
    }
    page++;
  }
  log(`[neko] done: pages=${stats.pages} items=${stats.items} khusus=${stats.khusus} failed=${stats.failed.length}`);
  return stats;
}

// ── Otakudesu (best effort — butuh FlareSolverr) ─────────────────
async function resolveOtaLink(serverList, defaultUrl) {
  if (defaultUrl && isMp4(defaultUrl)) return { url: defaultUrl, kind: "mp4" };
  const cands = [];
  for (const s of (serverList || [])) { const u = s?.url || s?.serverId; if (u) cands.push(u); }
  for (const u of cands) {
    if (isMp4(u)) return { url: u, kind: "mp4" };
    const r = await jget(`/otakudesu/resolve-stream?serverId=${encodeURIComponent(u)}`, 2, 2500);
    const url = r?.data?.url || r?.data?.details?.url;
    if (url && isMp4(url)) return { url, kind: "mp4" };
    if (url && /^https?:/.test(url)) return { url: otaProxy(url), kind: "embed" };
  }
  return null;
}

async function syncOtakudesu(DB) {
  const stats = { source: "otakudesu", pages: 0, anime: 0, episodes: 0, failed: [] };
  const r = await jget(`/otakudesu/ongoing`, 2, 6000);
  const list = r?.data?.animeList || [];
  log(`[ota] ongoing: ${list.length} anime`);
  for (const it of list.slice(0, PAGE_LIMIT)) {
    const id = it.animeId || it.id;
    if (!id) continue;
    const det = await jget(`/otakudesu/anime/${encodeURIComponent(id)}`, 2, 6000);
    const d = det?.data?.details || det?.data;
    if (!d || !(d.title || it.title)) { stats.failed.push("anime:" + id); continue; }
    const title = String(d.title || it.title).trim();
    const eps = Array.isArray(d.episodeList) ? d.episodeList : [];
    const epOut = [];
    for (const ep of eps) {
      const epId = ep.episodeId || ep.id;
      if (!epId) continue;
      const ed = await jget(`/otakudesu/episode/${encodeURIComponent(epId)}`, 2, 6000);
      const edet = ed?.data?.details || ed?.data;
      let link = null;
      if (edet) link = await resolveOtaLink(edet?.serverList, edet?.defaultStreamingUrl);
      if (!link) { stats.failed.push("ep:" + epId); link = { url: "", kind: "none" }; }
      const num = parseInt(ep.number || "1", 10) || 1;
      epOut.push({
        anime_id: id, number: num,
        title: String(ep.title || `Episode ${num}`),
        gdrive_links: JSON.stringify(link.url ? [{ url: link.url, label: link.kind === "mp4" ? "HD" : "Stream" }] : []),
        duration: 0, skip_intro: false, id: `${id}-${num}`, source: "otakudesu",
      });
    }
    const synopsis = Array.isArray(d.synopsis?.paragraphList) ? d.synopsis.paragraphList.join(" ") : String(d.synopsis || "");
    upsertAnime(DB, {
      id, slug: id, title,
      alt_titles: [], title_jp: "",
      synopsis, genres: Array.isArray(d.genres) ? d.genres : [],
      status: String(d.status || "Ongoing"), type: "TV",
      rating: parseFloat(d.score) || 0,
      aired_from: "", aired_to: "",
      episode_count: epOut.length, poster: d.poster || it.poster || "",
      created_at: new Date().toISOString(), source: "otakudesu", khusus: false,
    });
    DB.episodes = DB.episodes.filter(e => e.anime_id !== id).concat(epOut);
    stats.anime++;
    stats.episodes += epOut.length;
    log(`[ota] ${title} — ${epOut.length} eps ${linkHits(epOut)}`);
  }
  log(`[ota] done: anime=${stats.anime} eps=${stats.episodes} failed=${stats.failed.length}`);
  return stats;
}

// ── Umum ─────────────────────────────────────────────────────────
function upsertAnime(DB, a) {
  const ex = DB.anime.find(x => x.id === a.id);
  if (ex) Object.assign(ex, a);
  else DB.anime.push(a);
}

function loadDB() {
  if (!fs.existsSync(DB_PATH)) return { anime: [], episodes: [], khusus: [], users: [], history: [], bookmarks: [], watchlist: [], favorites: [], comments: [], reviews: [], notifications: [], settings: {}, khusus_password: "animebokep", sync_jobs: [] };
  try { return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); } catch (e) { console.error("Gagal baca db.json:", e.message); process.exit(1); }
}

function main() {
  const source = (process.argv[2] || "all").toLowerCase();
  if (!["kuramanime", "nekopoi", "otakudesu", "all"].includes(source)) { console.error("source harus kuramanime|nekopoi|otakudesu|all"); process.exit(1); }
  if (!fs.existsSync(DB_PATH)) { console.error("db.json tidak ditemukan di", DB_PATH); process.exit(1); }
  const backup = DB_PATH + ".bak." + Date.now();
  fs.copyFileSync(DB_PATH, backup);
  log(`backup: ${backup}`);
  log(`WAJIK=${WAJIK} DB=${DB_PATH} pageLimit=${PAGE_LIMIT} epLimit=${EP_LIMIT}`);
  const DB = loadDB();
  if (!Array.isArray(DB.khusus)) DB.khusus = [];
  if (!Array.isArray(DB.episodes)) DB.episodes = [];
  if (!Array.isArray(DB.anime)) DB.anime = [];
  if (!Array.isArray(DB.sync_jobs)) DB.sync_jobs = [];
  const start = Date.now();
  const run = async () => {
    const stats = [];
    if (source === "all" || source === "kuramanime") stats.push(await syncKuramanime(DB));
    if (source === "all" || source === "nekopoi") stats.push(await syncNekopoi(DB));
    if (source === "all" || source === "otakudesu") stats.push(await syncOtakudesu(DB));
    fs.writeFileSync(DB_PATH + ".tmp", JSON.stringify(DB, null, 2));
    fs.renameSync(DB_PATH + ".tmp", DB_PATH);
    log(`SELESAI dalam ${((Date.now() - start) / 1000).toFixed(1)}s — anime=${DB.anime.length} episodes=${DB.episodes.length} khusus=${DB.khusus.length}`);
    console.log(JSON.stringify({ ok: true, stats }));
    process.exit(0);
  };
  run().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
}

main();
