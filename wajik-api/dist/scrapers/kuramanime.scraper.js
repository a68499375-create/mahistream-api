import kuramanimeConfig from "../configs/kuramanime.config.js";
import getHTMLViaFlareSolverr, { getHTMLViaFlareSolverrPost } from "../helpers/getHTMLViaFlareSolverr.js";
import getHTML, { getBrowser, userAgent } from "../helpers/getHTML.js";
import { parse } from "node-html-parser";
const { baseUrl, fallbackUrls } = kuramanimeConfig;
// Daftar domain yang dicoba berurutan kalau domain utama gagal/Flare crash.
// Pakai `lastGoodHost` untuk memprioritaskan domain yang terakhir sukses.
// `failedHosts` menyimpan domain + timestamp ban — kalau domain baru saja
// gagal (mis. Flare timeout di Cloudflare challenge 60s), jangan dicoba lagi
// selama 3 menit supaya request berikutnya tidak nunggu 60s percuma.
let lastGoodHost = null;
const failedHosts = new Map();
// Sebelumnya 3 menit. Itu kepanjangan — sekali tiga host ke-ban semua,
// `/kuramanime/*` jadi tumbang massal selama 3 menit walau FlareSolverr-nya
// sebenarnya sehat. Turunkan jadi 30s supaya recovery cepat.
const FAILURE_COOLDOWN_MS = 15 * 1000;
const tryFlare = async (path, maxTimeout = 55000) => {
    const allHosts = [
        "https://v18.kuramanime.ing",
        "https://v9.kuramanime.work",
        "https://v9.kuramanime.blog",
    ].filter(Boolean);
    const now = Date.now();
    // Pisahkan host yang lagi di-cooldown vs yang sehat. Host sehat dicoba dulu.
    const healthy = [];
    const cooled = [];
    const tried = new Set();
    for (const host of allHosts) {
        if (tried.has(host))
            continue;
        tried.add(host);
        const banUntil = failedHosts.get(host);
        if (banUntil && banUntil > now)
            cooled.push(host);
        else
            healthy.push(host);
    }
    // Kalau semua host lagi cooldown, biarkan dicoba ulang (lebih baik lambat
    // daripada balik error tanpa coba).
    const candidates = healthy.length > 0 ? healthy : cooled;
    let lastErr = null;
    for (const host of candidates) {
        try {
            const url = new URL(path, host).toString();
            const html = await getHTMLViaFlareSolverr(url, maxTimeout);
            if (html && html.length > 200) {
                lastGoodHost = host;
                failedHosts.delete(host);
                return html;
            }
        }
        catch (e) {
            lastErr = e;
            failedHosts.set(host, Date.now() + FAILURE_COOLDOWN_MS);
            console.warn(`[kura] domain ${host} failed:`, e?.message || e);
        }
    }
    throw lastErr || new Error("All Kuramanime domains failed");
};
const tryFlarePost = async (path, postData, targetServer, maxTimeout = 55000) => {
    const allHosts = [
        "https://v18.kuramanime.ing",
        "https://v9.kuramanime.work",
        "https://v9.kuramanime.blog",
    ].filter(Boolean);
    const now = Date.now();
    const healthy = [];
    const cooled = [];
    const tried = new Set();
    for (const host of allHosts) {
        if (tried.has(host))
            continue;
        tried.add(host);
        const banUntil = failedHosts.get(host);
        if (banUntil && banUntil > now)
            cooled.push(host);
        else
            healthy.push(host);
    }
    const candidates = healthy.length > 0 ? healthy : cooled;
    let lastErr = null;
    for (const host of candidates) {
        try {
            const url = new URL(path, host).toString();
            const hostUrl = new URL(host);
            const cookies = [
                {
                    name: "preferred_stserver",
                    value: targetServer,
                    domain: hostUrl.host,
                    path: "/"
                }
            ];
            const html = await getHTMLViaFlareSolverrPost(url, postData, maxTimeout, cookies);
            if (html && html.length > 200) {
                lastGoodHost = host;
                failedHosts.delete(host);
                return html;
            }
        }
        catch (e) {
            lastErr = e;
            failedHosts.set(host, Date.now() + FAILURE_COOLDOWN_MS);
            console.warn(`[kura-post] domain ${host} failed:`, e?.message || e);
        }
    }
    throw lastErr || new Error("All Kuramanime domains failed in POST");
};
const tryPuppeteer = async (path, waitForSelector, maxTimeout = 60000) => {
    const allHosts = [
        lastGoodHost,
        ...(fallbackUrls && fallbackUrls.length > 0 ? fallbackUrls : [baseUrl]),
    ].filter(Boolean);
    const now = Date.now();
    const healthy = [];
    const cooled = [];
    const tried = new Set();
    for (const host of allHosts) {
        if (tried.has(host))
            continue;
        tried.add(host);
        const banUntil = failedHosts.get(host);
        if (banUntil && banUntil > now)
            cooled.push(host);
        else
            healthy.push(host);
    }
    const candidates = healthy.length > 0 ? healthy : cooled;
    let lastErr = null;
    for (const host of candidates) {
        try {
            const html = await getHTML(host, path, undefined, false, waitForSelector);
            if (html && html.length > 200) {
                lastGoodHost = host;
                failedHosts.delete(host);
                return html;
            }
        }
        catch (e) {
            lastErr = e;
            failedHosts.set(host, Date.now() + FAILURE_COOLDOWN_MS);
            console.warn(`[kura-pup] domain ${host} failed:`, e?.message || e);
        }
    }
    throw lastErr || new Error("All Kuramanime domains failed in Puppeteer");
};
// Kombinasi FlareSolverr (bypass Cloudflare) + Puppeteer (JS rendering).
// FlareSolverr return cf_clearance cookie → inject ke Puppeteer → Puppeteer
// navigate tanpa challenge → tunggu selector JS-rendered (episode list, dll).
const FLARE_URL = process.env.FLARESOLVERR_URL || "http://127.0.0.1:8191/v1";
const tryFlareWithPuppeteer = async (path, waitForSelector, timeout = 20000) => {
    const host = lastGoodHost || "https://v18.kuramanime.ing";
    const url = new URL(path, host).toString();
    // 1. Get cookies from FlareSolverr session
    let cookies = [];
    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 40000);
        const res = await fetch(FLARE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cmd: "request.get", url: host + "/", maxTimeout: 50000, session: "kuramanime" }),
            signal: controller.signal,
        });
        clearTimeout(t);
        const data = await res.json();
        if (data.status === "ok" && data.solution?.cookies) {
            cookies = data.solution.cookies;
        }
    }
    catch (e) {
        console.warn("[kura] Failed to get cookies from FlareSolverr:", e?.message);
    }
    if (cookies.length === 0) {
        throw new Error("No Cloudflare cookies available");
    }
    // 2. Use Puppeteer with those cookies
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.setUserAgent(userAgent);
        // Set cookies for the target domain
        const hostname = new URL(host).hostname;
        const puppeteerCookies = cookies
            .filter((c) => c.name && c.value)
            .map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain || hostname,
            path: c.path || "/",
            httpOnly: c.httpOnly ?? false,
            secure: c.secure ?? true,
            sameSite: "Lax",
        }));
        await page.setCookie(...puppeteerCookies);
        // 3. Navigate and wait for JS content
        await page.goto(url, { waitUntil: "domcontentloaded", timeout });
        if (waitForSelector) {
            try {
                await page.waitForSelector(waitForSelector, { timeout: 15000 });
            }
            catch {
                // Selector might not appear, wait a bit more for general JS
                await new Promise(r => setTimeout(r, 5000));
            }
        }
        else {
            await new Promise(r => setTimeout(r, 5000));
        }
        const html = await page.content();
        if (html && html.length > 500) {
            lastGoodHost = host;
            return html;
        }
        throw new Error("Page content too short");
    }
    finally {
        await page.close();
    }
};
const kuramanimeScraper = {
    async scrapeDOM(pathname, ref, sanitize = false, waitForSelector) {
        // Strategi baru: Puppeteer dulu (dengan host-resolver-rules bypass),
        // FlareSolverr sebagai fallback. Puppeteer lebih cepat dan reliable
        // untuk kuramanime karena bisa bypass Cloudflare via edge IP mapping.
        if (pathname.includes("/episode/")) {
            // Episode pages: coba Puppeteer dulu
            try {
                const html = await tryPuppeteer(pathname, "#changeServer option, #animeDownloadLink a", 30000);
                if (html && html.length > 500)
                    return parse(html, { parseNoneClosedTags: true });
            }
            catch (err) {
                console.warn("[kuramanimeScraper] Puppeteer for episode failed:", err?.message);
            }
            // Fallback: FlareSolverr POST
            try {
                const token = await this.scrapeSecret();
                const parsedUrl = new URL(pathname, "https://dummy.com");
                const targetServer = parsedUrl.searchParams.get("server") || "kuramadrive";
                const cleanPathname = parsedUrl.pathname;
                const postPath = `${cleanPathname}?weyJH=${token}&KWtbC=${targetServer}&page=1`;
                console.log(`[kuramanimeScraper] Fetching dynamic POST for ${pathname} using server ${targetServer}`);
                const html = await tryFlarePost(postPath, "authorization=kJuHHkaqcBFXiGMHQf6bJw8YAyDcwGD8Ur", targetServer);
                return parse(html, { parseNoneClosedTags: true });
            }
            catch (err) {
                console.error("[kuramanimeScraper] All methods failed for episode:", err);
                throw err;
            }
        }
        // For anime detail pages: Puppeteer dulu (langsung, tanpa FlareSolverr)
        if (pathname.includes("/anime/") && !pathname.includes("/episode/")) {
            console.log(`[kuramanimeScraper] Using Puppeteer for anime detail: ${pathname}`);
            try {
                const html = await tryPuppeteer(pathname, waitForSelector, 30000);
                if (html && html.length > 500)
                    return parse(html, { parseNoneClosedTags: true });
            }
            catch (err) {
                console.warn("[kuramanimeScraper] Puppeteer for anime detail failed:", err?.message);
            }
            // Fallback: FlareSolverr+Puppeteer hybrid
            console.log(`[kuramanimeScraper] Using FlareSolverr+Puppeteer hybrid for anime detail: ${pathname}`);
            try {
                const html = await tryFlareWithPuppeteer(pathname, waitForSelector, 30000);
                if (html && html.length > 500)
                    return parse(html, { parseNoneClosedTags: true });
            }
            catch (err) {
                console.warn("[kuramanimeScraper] Hybrid failed:", err?.message);
            }
            // Last resort: tryFlare
            try {
                const html = await tryFlare(pathname);
                if (html && html.length > 500)
                    return parse(html, { parseNoneClosedTags: true });
            }
            catch (err) {
                console.error("[kuramanimeScraper] All methods failed for anime detail:", err?.message);
            }
        }
        // For other pages (latest, schedule, browse, etc.): Puppeteer dulu
        try {
            const html = await tryPuppeteer(pathname, undefined, 30000);
            if (html && html.length > 500)
                return parse(html, { parseNoneClosedTags: true });
        }
        catch (err) {
            console.warn("[kuramanimeScraper] Puppeteer for other page failed:", err?.message);
        }
        // Fallback: FlareSolverr
        const html = await tryFlare(pathname);
        const document = parse(html, {
            parseNoneClosedTags: true,
        });
        return document;
    },
    async scrapeSecret(ref) {
        try {
            const html = await tryPuppeteer("/assets/Ks6sqSgloPTlHMl.txt", undefined, 15000);
            const document = parse(html);
            const text = (document.querySelector("pre")?.text || html).trim();
            if (text)
                return text;
        }
        catch (err) {
            console.warn("[kuramanimeScraper] Puppeteer scrapeSecret failed:", err?.message);
        }
        const html = await tryFlare("/assets/Ks6sqSgloPTlHMl.txt");
        const document = parse(html);
        const text = (document.querySelector("pre")?.text || html).trim();
        return text;
    },
};
export default kuramanimeScraper;
