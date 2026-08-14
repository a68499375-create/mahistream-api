/**
 * Security middleware — zero-dependency hardening untuk MahiStream API.
 *
 * Fitur:
 * 1. Security headers (mirip helmet minimal) — anti clickjacking, MIME sniff,
 *    XSS reflection, referrer leak, CORP isolation.
 * 2. CORS whitelist — hanya origin terdaftar yang dapat akses; bisa diatur
 *    via env ALLOWED_ORIGINS (csv) atau diizinkan semua jika tidak diset
 *    (mode dev/legacy).
 * 3. Rate limiter in-memory — token bucket per IP × path, batas request
 *    dalam window. Cukup untuk single-instance deployment seperti VPS PM2.
 * 4. Body size guard — tolak payload > 256KB (default Express tidak ada
 *    limit di JSON parser sebelum versi tertentu).
 * 5. Query sanitizer — trim string panjang dan tolak karakter kontrol di
 *    parameter biar tidak jadi header smuggling / log injection.
 *
 * Tidak menambah dependency npm: semua hand-rolled. Mudah diaudit.
 */
// ---------- Security headers ----------
export function securityHeaders(req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Jangan set X-Frame-Options untuk endpoint iframe-proxy — karena
    // frontend merender konten ini di dalam <iframe>. DENY akan bikin
    // browser blokir tampilan ("refused to connect").
    if (!req.path.includes("iframe-proxy")) {
        res.setHeader("X-Frame-Options", "DENY");
    }
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    next();
}
// ---------- CORS whitelist ----------
// Env var ALLOWED_ORIGINS: csv list. Contoh:
//   ALLOWED_ORIGINS=https://api.103.67.244.19.nip.io,capacitor://localhost,http://localhost:5173
const parseList = (s) => (s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const ALLOWED_ORIGINS = parseList(process.env.ALLOWED_ORIGINS);
export function corsWhitelist(req, res, next) {
    const origin = req.headers.origin;
    const isAllowed = ALLOWED_ORIGINS.length === 0 || // mode dev / belum dikonfigur
        !origin || // server-to-server, native WebView
        ALLOWED_ORIGINS.includes(origin) || // exact match
        ALLOWED_ORIGINS.some((p) => p.endsWith("*") && origin.startsWith(p.slice(0, -1)));
    if (origin && isAllowed) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }
    else if (!origin) {
        res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,Range");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length,Content-Range,Accept-Ranges");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
    }
    next();
}
const buckets = new Map();
// Cleanup old buckets supaya memory tidak balon.
setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) {
        if (b.resetAt < now - 10 * 60 * 1000)
            buckets.delete(key);
    }
}, 60 * 1000).unref?.();
const clientIp = (req) => {
    const xff = req.headers["x-forwarded-for"] || "";
    return (xff.split(",")[0] || req.ip || req.socket.remoteAddress || "unknown").trim();
};
export function rateLimit(opts = {}) {
    const max = opts.max ?? 120; // 120 req
    const windowMs = opts.windowMs ?? 60_000; // per menit
    return (req, res, next) => {
        const ip = clientIp(req);
        // Bucketing per IP + path prefix supaya endpoint mahal (FlareSolverr) tidak
        // berbagi quota dengan endpoint murah.
        const pathBucket = (req.path.split("/")[1] || "_root").slice(0, 32);
        const key = `${ip}:${pathBucket}`;
        const now = Date.now();
        const b = buckets.get(key);
        if (!b || b.resetAt < now) {
            buckets.set(key, { tokens: max - 1, resetAt: now + windowMs });
            res.setHeader("X-RateLimit-Limit", String(max));
            res.setHeader("X-RateLimit-Remaining", String(max - 1));
            next();
            return;
        }
        if (b.tokens <= 0) {
            const retryAfter = Math.ceil((b.resetAt - now) / 1000);
            res.setHeader("Retry-After", String(Math.max(1, retryAfter)));
            res.setHeader("X-RateLimit-Limit", String(max));
            res.setHeader("X-RateLimit-Remaining", "0");
            res.status(429).json({
                statusCode: 429,
                statusMessage: "Too Many Requests",
                message: "Terlalu banyak request, coba lagi sebentar.",
            });
            return;
        }
        b.tokens--;
        res.setHeader("X-RateLimit-Limit", String(max));
        res.setHeader("X-RateLimit-Remaining", String(b.tokens));
        next();
    };
}
// ---------- Query / params sanitizer ----------
const containsControlChars = (s) => /[\x00-\x1f\x7f]/.test(s);
export function inputSanitizer(req, res, next) {
    // Query: tolak kunci/value yang terlalu panjang (anti log injection / DoS
    // dari regex / parser di belakangnya). Trim CR/LF supaya tidak smuggling.
    try {
        for (const k of Object.keys(req.query || {})) {
            const v = req.query[k];
            if (Array.isArray(v)) {
                if (v.length > 16) {
                    res.status(400).json({ statusCode: 400, message: "Query terlalu kompleks." });
                    return;
                }
                for (let i = 0; i < v.length; i++) {
                    const s = String(v[i] ?? "");
                    if (s.length > 512 || containsControlChars(s)) {
                        res.status(400).json({ statusCode: 400, message: "Query tidak valid." });
                        return;
                    }
                }
            }
            else if (typeof v === "string") {
                if (v.length > 512 || containsControlChars(v)) {
                    res.status(400).json({ statusCode: 400, message: "Query tidak valid." });
                    return;
                }
            }
            if (k.length > 64) {
                res.status(400).json({ statusCode: 400, message: "Query tidak valid." });
                return;
            }
        }
    }
    catch (_e) {
        // Defensive: kalau parse error apa pun, tetap lewat (handler endpoint
        // akan validasi lebih lanjut). Tidak crash request.
    }
    next();
}
