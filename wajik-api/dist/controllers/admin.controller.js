import setPayload from "../helpers/setPayload.js";
const FLARE_URL = process.env.FLARESOLVERR_URL || "http://127.0.0.1:8191/v1";
const PING_TIMEOUT = 15000;
async function pingUrl(url, label) {
    const start = Date.now();
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), PING_TIMEOUT);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        const time = Date.now() - start;
        if (res.ok) {
            return { label, status: "ok", time };
        }
        return { label, status: `HTTP ${res.status}`, time };
    }
    catch (e) {
        return { label, status: "error", time: Date.now() - start, error: e?.message || "timeout" };
    }
}
const adminController = {
    async status(req, res) {
        const BASE = "http://127.0.0.1:3001";
        const results = await Promise.allSettled([
            pingUrl(`${BASE}/`, "Backend Root"),
            pingUrl(`${BASE}/kuramanime/search?q=naruto`, "Kuramanime Search"),
            pingUrl(`${BASE}/kuramanime/genres`, "Kuramanime Genres"),
            pingUrl(`${BASE}/kuramanime/latest?page=1`, "Kuramanime Latest"),
            pingUrl(`${BASE}/otakudesu/search?q=naruto`, "Otakudesu Search"),
            pingUrl(`${BASE}/otakudesu/ongoing`, "Otakudesu Ongoing"),
            pingUrl(`${BASE}/nekopoi/search?q=naruto`, "Nekopoi Search"),
            pingUrl(`${BASE}/aggregate/home`, "Aggregate Home"),
            pingUrl(`${BASE}/aggregate/schedule`, "Aggregate Schedule"),
        ]);
        const endpoints = results.map((r, i) => {
            if (r.status === "fulfilled")
                return r.value;
            return { label: `Unknown ${i}`, status: "error", time: 0, error: "Promise rejected" };
        });
        return res.status(200).json(setPayload(res, { data: { endpoints } }));
    },
    async flareStatus(_req, res) {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 10000);
            const flareRes = await fetch(FLARE_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cmd: "sessions.list" }),
                signal: ctrl.signal,
            });
            clearTimeout(t);
            if (!flareRes.ok) {
                return res.status(200).json(setPayload(res, { data: { status: "error", message: `HTTP ${flareRes.status}` } }));
            }
            const data = await flareRes.json();
            return res.status(200).json(setPayload(res, { data: { status: "ok", sessions: data.sessions || [] } }));
        }
        catch (e) {
            return res.status(200).json(setPayload(res, { data: { status: "error", message: e?.message || "timeout" } }));
        }
    },
    async cacheStats(_req, res) {
        const cacheSize = (global.__streamCache?.size || 0);
        return res.status(200).json(setPayload(res, { data: { cacheEntries: cacheSize, cacheTTL: "5 menit" } }));
    },
    async systemInfo(_req, res) {
        const info = {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            nodeVersion: process.version,
            platform: process.platform,
            cpuUsage: process.cpuUsage(),
        };
        return res.status(200).json(setPayload(res, { data: info }));
    }
};
export default adminController;
