import otakudesuScraper from "../scrapers/otakudesu.scraper.js";
import otakudesuParser from "../parsers/otakudesu.parser.js";
import kuramanimeParser from "../parsers/kuramanime.parser.js";
import setPayload from "../helpers/setPayload.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// File-based cache untuk /aggregate/home. Disimpan agar respons "anime baru"
// tetap berisi banyak entri walau Cloudflare/FlareSolverr lagi block atau
// VPS lambat. TTL fresh = 10 menit; stale-but-usable = 60 menit.
const CACHE_DIR = process.env.AGG_CACHE_DIR || path.join(__dirname, "../../data");
const HOME_CACHE_FILE = path.join(CACHE_DIR, "aggregate_home_cache.json");
const HOME_CACHE_FRESH_MS = 10 * 60 * 1000;
const HOME_CACHE_STALE_MS = 60 * 60 * 1000;
const ensureCacheDir = () => {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    catch (_e) { /* ignore */ }
};
const readHomeCache = () => {
    try {
        console.log("[aggregate/home] reading cache file from:", HOME_CACHE_FILE);
        const raw = fs.readFileSync(HOME_CACHE_FILE, "utf8");
        const parsed = JSON.parse(raw);
        console.log("[aggregate/home] cache parsed, has ts:", typeof parsed?.ts, "has data:", !!parsed?.data);
        if (parsed && typeof parsed.ts === "number" && parsed.data) {
            console.log("[aggregate/home] cache loaded successfully, entries:", parsed.data.ongoing?.animeList?.length);
            return parsed;
        }
        console.log("[aggregate/home] cache invalid:", parsed);
    }
    catch (e) {
        console.error("[aggregate/home] failed to read cache:", e.message);
    }
    return null;
};
const writeHomeCache = (data) => {
    try {
        ensureCacheDir();
        fs.writeFileSync(HOME_CACHE_FILE, JSON.stringify({ ts: Date.now(), data }));
    }
    catch (e) {
        console.error("[aggregate/home] failed to write cache", e);
    }
};
// Membangun payload home dari Kuramanime + Otakudesu paralel. Kalau Kuramanime
// mengembalikan data, hasilnya disimpan ke disk supaya selanjutnya bisa
// di-serve walaupun Cloudflare sedang memblokir.
async function buildHomeAndCache() {
    const withTimeout = (p, ms) => Promise.race([
        p,
        new Promise((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
    const kuraCustomSafe = async (p) => {
        try {
            const r = await withTimeout(kuramanimeParser.parseCustom(p), 35000);
            return Array.isArray(r) ? r : [];
        }
        catch (e) {
            console.error(`[aggregate/home] kura custom "${p}" failed`, e);
            return [];
        }
    };
    // Home SEPENUHNYA dari Kuramanime (sesuai permintaan). Fetch 3 halaman
    // paralel — page 1 = ongoing (paling baru), page 2-3 dipakai sebagai
    // overflow untuk completed/latest list. Otakudesu DIHAPUS total dari
    // home: dulu ada sebagai fallback kalau Kura kosong, tapi user explicit
    // minta hanya Kura. Kalau Kura down, frontend stale-while-revalidate
    // akan tampilkan data dari cache `home_v2`.
    const [kuraPage1, kuraPage2, kuraPage3] = await Promise.all([
        kuraCustomSafe("/anime?order_by=updated&page=1"),
        kuraCustomSafe("/anime?order_by=updated&page=2"),
        kuraCustomSafe("/anime?order_by=updated&page=3"),
    ]);
    const mapKura = (it, fallbackEpisodes) => ({
        animeId: it.animeId,
        title: it.title,
        poster: it.poster,
        episodes: fallbackEpisodes,
        source: "kuramanime",
        url: it.url,
        score: it.score,
    });
    const norm = (t) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const kuraSeen = new Set();
    const kuraOngoing = [];
    const kuraOverflow = [];
    // Page 1 -> ongoing list. Page 2-3 -> completed/overflow.
    kuraPage1.forEach((it) => {
        const k = norm(it.title);
        if (!k || kuraSeen.has(k))
            return;
        kuraSeen.add(k);
        kuraOngoing.push(mapKura(it, "Ongoing"));
    });
    [...kuraPage2, ...kuraPage3].forEach((it) => {
        const k = norm(it.title);
        if (!k || kuraSeen.has(k))
            return;
        kuraSeen.add(k);
        kuraOverflow.push(mapKura(it, "Completed"));
    });
    const ongoingList = kuraOngoing.slice(0, 30);
    const completedList = kuraOverflow.slice(0, 30);
    const home = {
        ongoing: { animeList: ongoingList },
        completed: { animeList: completedList },
    };
    // Simpan ke cache hanya kalau hasilnya layak (>= 10 entri ongoing). Sumber
    // kini SEPENUHNYA Kuramanime jadi tidak ada lagi cek source per item.
    if (ongoingList.length >= 10) {
        writeHomeCache(home);
    }
    return home;
}
const aggregateController = {
    async search(req, res) {
        const query = req.query.q;
        const page = parseInt(req.query.page) || 1;
        if (!query)
            return res.status(400).json(setPayload(res, { message: "Query is required" }));
        try {
            const withTimeout = (promise, ms) => {
                return Promise.race([
                    promise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms))
                ]);
            };
            // Tidak pakai Jikan API lagi — sumber utama (Kuramanime) sudah punya
            // indeks pencarian server-side yang cocok untuk judul Inggris/Romaji/
            // Jepang, jadi kirim query asli ke semua sumber dan biarkan
            // matching/fuzzy dilakukan di frontend.
            const queries = [query];
            const otakuUrl = (q) => page > 1
                ? `/page/${page}/?s=${encodeURIComponent(q)}&post_type=anime`
                : `/?s=${encodeURIComponent(q)}&post_type=anime`;
            let otakuResults = [];
            let kuraResults = [];
            let nekoResults = [];
            // Tiap sumber dijalankan paralel; setiap sumber menjelajah seluruh
            // variant judul juga paralel, lalu dideduplikasi.
            const runSource = async (run, timeoutMs) => {
                const lists = await Promise.all(queries.map((q) => withTimeout(run(q), timeoutMs)
                    .then((r) => Array.isArray(r) ? r : [])
                    .catch(() => [])));
                const seen = new Set();
                const out = [];
                for (const lst of lists) {
                    for (const it of lst) {
                        const key = (it.animeId || it.id || it.url || "").toString();
                        if (!key || seen.has(key))
                            continue;
                        seen.add(key);
                        out.push(it);
                    }
                }
                return out;
            };
            const allRunners = await Promise.all([
                runSource(async (q) => {
                    const otakudesuScraper = (await import("../scrapers/otakudesu.scraper.js")).default;
                    const otakuDoc = await otakudesuScraper.scrapeDOM(otakuUrl(q), "https://otakudesu.blog/");
                    return otakudesuParser.parseSearchedAnimes(otakuDoc);
                }, 15000).then((r) => { otakuResults = r; }),
                // Kuramanime via FlareSolverr biasanya butuh 15-22 detik per request.
                runSource((q) => kuramanimeParser.parseSearch(q, page), 30000).then((r) => { kuraResults = r; }),
                runSource(async (q) => {
                    const nekopoiScraper = (await import("../scrapers/nekopoi.scraper.js")).default;
                    const nekopoiParser = (await import("../parsers/nekopoi.parser.js")).default;
                    const html = await nekopoiScraper.getSearch(q, page);
                    return nekopoiParser.parseSearch(html);
                }, 20000).then((r) => { nekoResults = r; }),
            ]);
            void allRunners;
            // Helper function to normalize titles for deduplication
            const normalizeTitle = (title) => {
                let normalized = title.toLowerCase();
                // Remove content in brackets or parentheses
                normalized = normalized.replace(/\s*[([].*?[\])]/g, "");
                // Remove common suffixes/words
                const suffixesToRemove = [
                    "subtitle indonesia",
                    "sub indonesia",
                    "sub indo",
                    "subtitle",
                    "sub",
                    "indonesia",
                    "indo",
                    "ongoing",
                    "completed",
                    "tamat",
                    "samehadaku",
                    "otakudesu",
                    "kuramanime",
                    "nekopoi"
                ];
                for (const suffix of suffixesToRemove) {
                    const regex = new RegExp(`\\b${suffix}\\b`, "g");
                    normalized = normalized.replace(regex, "");
                }
                return normalized.replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
            };
            const deduplicated = [];
            const addSourceResults = (results, sourceName) => {
                for (const item of results) {
                    if (!item || !item.title)
                        continue;
                    const norm = normalizeTitle(item.title);
                    const animeId = item.animeId || item.id;
                    const poster = item.poster || item.image || "";
                    let existing = deduplicated.find(d => normalizeTitle(d.title) === norm);
                    if (!existing) {
                        existing = {
                            id: animeId,
                            title: item.title,
                            poster_url: poster,
                            rating: item.score || "N/A",
                            availableSources: [],
                            sourceIds: {}
                        };
                        deduplicated.push(existing);
                    }
                    if (!existing.availableSources.includes(sourceName)) {
                        existing.availableSources.push(sourceName);
                    }
                    existing.sourceIds[sourceName] = animeId;
                    // Merge fields if missing/better
                    if (existing.rating === "N/A" && item.score && item.score !== "N/A") {
                        existing.rating = item.score;
                    }
                    if (!existing.poster_url && poster) {
                        existing.poster_url = poster;
                    }
                }
            };
            addSourceResults(otakuResults, "otakudesu");
            addSourceResults(kuraResults, "kuramanime");
            addSourceResults(nekoResults, "nekopoi");
            return res.status(200).json(setPayload(res, { data: deduplicated }));
        }
        catch (e) {
            return res.status(500).json(setPayload(res, { message: "Failed to aggregate search" }));
        }
    },
    async home(req, res) {
        const cached = readHomeCache();
        const cacheAge = cached ? Date.now() - cached.ts : Infinity;
        // Jika cache masih fresh (< 10 menit), langsung serve dan refresh di
        // background. Strategi ini memastikan pengguna tidak pernah lihat home
        // kosong walau FlareSolverr lambat.
        if (cached && cacheAge < HOME_CACHE_FRESH_MS) {
            res.status(200).json(setPayload(res, { data: cached.data }));
            // refresh in background, fire-and-forget
            void buildHomeAndCache().catch((e) => console.error("[aggregate/home] background refresh failed", e));
            return;
        }
        try {
            const home = await buildHomeAndCache();
            // Fallback to cache if scraped data is empty (e.g. FlareSolverr/Cloudflare block)
            if ((!home.ongoing?.animeList || home.ongoing.animeList.length === 0) && cached) {
                console.warn("[aggregate/home] build returned empty list, falling back to cache");
                return res.status(200).json(setPayload(res, { data: cached.data }));
            }
            return res.status(200).json(setPayload(res, { data: home }));
        }
        catch (e) {
            console.error("[aggregate/home] build failed", e);
            // Stale cache fallback: kalau fresh fetch gagal, pakai cache
            if (cached) {
                return res.status(200).json(setPayload(res, { data: cached.data }));
            }
            return res.status(500).json(setPayload(res, { message: "Failed to get home" }));
        }
    },
    // Schedule gabungan: ambil dari Kuramanime (yang punya poster + jam) dan
    // Otakudesu, lalu satukan per hari. Hari kerja Otakudesu (cuma judul) dipakai
    // sebagai cadangan kalau Kuramanime tidak mengembalikan apa-apa untuk hari
    // tertentu, sehingga hari Senin-Minggu pasti terisi.
    async schedule(req, res) {
        try {
            let kuraSchedule = [];
            let otakuSchedule = [];
            const withTimeout = (p, ms) => Promise.race([
                p,
                new Promise((_, reject) => setTimeout(() => reject(new Error("Schedule timeout")), ms)),
            ]);
            try {
                kuraSchedule = await withTimeout(kuramanimeParser.parseSchedule(), 25000);
            }
            catch (e) {
                console.error("Kuramanime schedule failed", e);
            }
            try {
                const doc = await withTimeout(otakudesuScraper.scrapeDOM("/jadwal-rilis/", "https://otakudesu.blog/"), 20000);
                otakuSchedule = otakudesuParser.parseSchedules(doc);
            }
            catch (e) {
                console.error("Otakudesu schedule failed", e);
            }
            const days = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
            // Build poster lookup pool dari Kuramanime browse cache (parseCustom)
            // — jadwal Otakudesu yang tidak punya poster bisa di-match by title
            // ke pool ini. Hasilnya: hampir semua slot di Jadwal Rilis punya poster
            // walaupun sumbernya Otakudesu yang text-only.
            const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
            const posterPool = new Map();
            try {
                const [p1, p2] = await Promise.all([
                    withTimeout(kuramanimeParser.parseCustom("/anime?order_by=updated&page=1"), 25000),
                    withTimeout(kuramanimeParser.parseCustom("/anime?order_by=updated&page=2"), 25000),
                ]);
                [...(p1 || []), ...(p2 || [])].forEach((it) => {
                    if (it?.title && it?.poster) {
                        posterPool.set(norm(it.title), it.poster);
                    }
                });
            }
            catch (_e) {
                /* poster pool optional, lanjut tanpa */
            }
            const findPoster = (title) => {
                const k = norm(title);
                if (posterPool.has(k))
                    return posterPool.get(k);
                // Cocokkan partial — title bisa beda "Season X" / "Part Y" suffix.
                for (const [key, poster] of posterPool) {
                    if (key.startsWith(k) || k.startsWith(key))
                        return poster;
                }
                return "";
            };
            const merged = days.map((day) => {
                const kura = kuraSchedule.find((s) => (s.title || "").toLowerCase() === day.toLowerCase());
                const otaku = otakuSchedule.find((s) => (s.title || "").toLowerCase() === day.toLowerCase());
                const list = [];
                const seen = new Set();
                (kura?.animeList || []).forEach((it) => {
                    const key = (it.title || "").toLowerCase().trim();
                    if (!key || seen.has(key))
                        return;
                    seen.add(key);
                    list.push({
                        animeId: it.animeId,
                        title: it.title,
                        poster: it.poster || "",
                        jam: it.jam || "",
                        source: "kuramanime",
                        url: it.url || "",
                    });
                });
                (otaku?.animeList || []).forEach((it) => {
                    const key = (it.title || "").toLowerCase().trim();
                    if (!key || seen.has(key))
                        return;
                    seen.add(key);
                    list.push({
                        animeId: it.animeId,
                        title: it.title,
                        poster: findPoster(it.title), // enrich poster from Kura pool
                        jam: "",
                        source: "otakudesu",
                        url: it.otakudesuUrl || "",
                    });
                });
                return { title: day, animeList: list };
            });
            return res.status(200).json(setPayload(res, { data: { scheduleList: merged } }));
        }
        catch (e) {
            console.error("Aggregate schedule failed:", e);
            // Return empty schedule instead of error
            const days = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
            const emptySchedule = days.map(day => ({ title: day, animeList: [] }));
            return res.status(200).json(setPayload(res, { data: { scheduleList: emptySchedule } }));
        }
    }
};
export default aggregateController;
