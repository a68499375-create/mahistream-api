// Release tracker: polls Kuramanime schedule + per-anime episode list every
// 15 minutes, detects new episodes vs the persisted snapshot, and pushes
// detected releases into an in-memory queue (also persisted to disk) that
// the frontend consumes via /notifications/pending to schedule local push
// notifications. Designed to be tolerant: every step is wrapped in try/catch
// so a single failure does not stop the loop.
import path from "path";
import fs from "fs/promises";
import kuramanimeParser from "../parsers/kuramanime.parser.js";
// Persistent state lives next to the app (matches /var/www/mahistream-api/data
// on the VPS, and ./data on local dev). Using process.cwd() keeps it portable.
const DATA_DIR = path.resolve(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "release_tracker.json");
const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const FIRST_POLL_DELAY_MS = 30 * 1000; // wait 30s after boot before first poll
const MAX_PENDING = 100; // cap queue
const MAX_ANIME_PER_POLL = 10; // only top 10 schedule entries
let state = {
    lastEpisodes: {},
    pendingReleases: [],
};
let started = false;
let pollTimer = null;
let saveTimer = null;
async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    }
    catch (e) {
        console.warn("[releaseTracker] ensureDataDir failed", e);
    }
}
async function loadState() {
    try {
        const raw = await fs.readFile(STATE_FILE, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
            const lastEpisodes = parsed.lastEpisodes && typeof parsed.lastEpisodes === "object"
                ? parsed.lastEpisodes
                : {};
            const pendingReleases = Array.isArray(parsed.pendingReleases)
                ? parsed.pendingReleases
                : [];
            state = { lastEpisodes, pendingReleases };
            console.log(`[releaseTracker] state loaded: ${Object.keys(lastEpisodes).length} tracked anime, ${pendingReleases.length} pending`);
        }
    }
    catch (e) {
        if (e?.code !== "ENOENT") {
            console.warn("[releaseTracker] loadState failed", e);
        }
        else {
            console.log("[releaseTracker] no existing state, starting fresh");
        }
    }
}
// Debounced save: many writes within a poll cycle collapse into one fs hit.
function scheduleSave() {
    if (saveTimer)
        return;
    saveTimer = setTimeout(async () => {
        saveTimer = null;
        try {
            await ensureDataDir();
            await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
        }
        catch (e) {
            console.warn("[releaseTracker] saveState failed", e);
        }
    }, 200);
}
// Pull the highest episode number from an episodeList. Prefers parsing
// the trailing `/episode/<n>` segment of episodeId since it matches Kuramanime's
// canonical numbering; falls back to digits in the human title.
function getMaxEpisodeNumber(episodeList) {
    if (!Array.isArray(episodeList) || episodeList.length === 0)
        return 0;
    let max = 0;
    for (const ep of episodeList) {
        let n = 0;
        const idStr = String(ep?.episodeId || "");
        const idMatch = idStr.match(/episode\/(\d+)/);
        if (idMatch && idMatch[1]) {
            n = parseInt(idMatch[1], 10);
        }
        else {
            const titleMatch = String(ep?.title || "").match(/\d+/);
            if (titleMatch && titleMatch[0]) {
                n = parseInt(titleMatch[0], 10);
            }
        }
        if (!isNaN(n) && n > max)
            max = n;
    }
    return max;
}
async function pollOnce() {
    console.log("[releaseTracker] poll start");
    let schedule = [];
    try {
        schedule = await kuramanimeParser.parseSchedule();
    }
    catch (e) {
        console.warn("[releaseTracker] parseSchedule failed", e);
        return;
    }
    // Flatten schedule into a unique list of anime, take only first N.
    const flat = [];
    const seen = new Set();
    for (const day of schedule || []) {
        const list = day?.animeList || [];
        for (const item of list) {
            const animeId = item?.animeId;
            if (!animeId || seen.has(animeId))
                continue;
            seen.add(animeId);
            flat.push({
                animeId,
                title: String(item?.title || ""),
                poster: String(item?.poster || ""),
            });
        }
    }
    const targets = flat.slice(0, MAX_ANIME_PER_POLL);
    console.log(`[releaseTracker] checking ${targets.length} anime from schedule`);
    let newDetections = 0;
    // Sequential because Kuramanime runs through FlareSolverr — parallelizing
    // would just queue requests on the same singleton browser.
    for (const t of targets) {
        try {
            const details = await kuramanimeParser.parseAnimeDetails(t.animeId);
            const latest = getMaxEpisodeNumber(details?.episodeList || []);
            if (!latest)
                continue;
            const prev = state.lastEpisodes[t.animeId] ?? 0;
            if (prev === 0) {
                // First sighting — establish a baseline so we don't notify retroactively
                // about every existing episode.
                state.lastEpisodes[t.animeId] = latest;
            }
            else if (latest > prev) {
                const release = {
                    animeId: t.animeId,
                    title: t.title || String(details?.title || ""),
                    episodeNumber: latest,
                    poster: t.poster || String(details?.poster || ""),
                    source: "kuramanime",
                    detectedAt: Date.now(),
                };
                state.pendingReleases.push(release);
                if (state.pendingReleases.length > MAX_PENDING) {
                    state.pendingReleases = state.pendingReleases.slice(state.pendingReleases.length - MAX_PENDING);
                }
                state.lastEpisodes[t.animeId] = latest;
                newDetections++;
                console.log(`[releaseTracker] new episode: ${release.title} ep ${latest} (was ${prev})`);
            }
        }
        catch (e) {
            console.warn(`[releaseTracker] details failed for ${t.animeId}`, e);
        }
    }
    scheduleSave();
    console.log(`[releaseTracker] poll done — ${newDetections} new releases, queue size ${state.pendingReleases.length}`);
}
export function getPendingReleases(sinceMs) {
    if (!sinceMs || isNaN(sinceMs) || sinceMs <= 0) {
        return state.pendingReleases.slice();
    }
    return state.pendingReleases.filter((r) => r.detectedAt > sinceMs);
}
export function ackRelease(animeId, episode) {
    const before = state.pendingReleases.length;
    state.pendingReleases = state.pendingReleases.filter((r) => !(r.animeId === animeId && r.episodeNumber === episode));
    const removed = state.pendingReleases.length !== before;
    if (removed)
        scheduleSave();
    return removed;
}
export async function startReleaseTracker() {
    if (started)
        return;
    started = true;
    await loadState();
    // Delay first poll slightly so the rest of app boot finishes first.
    setTimeout(() => {
        pollOnce().catch((e) => console.warn("[releaseTracker] initial poll error", e));
    }, FIRST_POLL_DELAY_MS);
    pollTimer = setInterval(() => {
        pollOnce().catch((e) => console.warn("[releaseTracker] poll error", e));
    }, POLL_INTERVAL_MS);
    console.log(`[releaseTracker] started, interval ${POLL_INTERVAL_MS / 1000}s, state file ${STATE_FILE}`);
}
export function stopReleaseTracker() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    started = false;
}
