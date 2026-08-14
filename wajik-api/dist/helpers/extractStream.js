import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
const puppeteerExtra = puppeteer.default || puppeteer;
puppeteerExtra.use(StealthPlugin());
export const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
// --- Simple In-Memory Cache ---
const streamCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 menit
const CACHE_MAX = 500;
function cacheGet(key) {
    const entry = streamCache.get(key);
    if (!entry)
        return undefined;
    if (Date.now() - entry.ts > CACHE_TTL) {
        streamCache.delete(key);
        return undefined;
    }
    return entry.result;
}
function cacheSet(key, result) {
    if (streamCache.size >= CACHE_MAX) {
        const oldest = streamCache.entries().next().value;
        if (oldest)
            streamCache.delete(oldest[0]);
    }
    streamCache.set(key, { result, ts: Date.now() });
}
// --- Browser Singleton ---
let browserInstance = null;
let browserPromise = null;
async function getBrowser() {
    if (browserInstance?.isConnected())
        return browserInstance;
    if (browserPromise)
        return browserPromise;
    browserPromise = puppeteerExtra.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-web-security",
            "--disable-features=IsolateOrigins,site-per-process",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--single-process"
        ]
    }).then((b) => {
        browserInstance = b;
        b.on('disconnected', () => { browserInstance = null; browserPromise = null; });
        return b;
    });
    const pending = browserPromise;
    pending.finally(() => { browserPromise = null; });
    return pending;
}
// --- Concurrency Limiter ---
let active = 0;
const MAX_CONCURRENT = 3;
const queue = [];
async function acquireSlot() {
    if (active < MAX_CONCURRENT) {
        active++;
        return;
    }
    await new Promise(resolve => queue.push(resolve));
    active++;
}
function releaseSlot() {
    active--;
    const next = queue.shift();
    if (next)
        next();
}
// False positive patterns to exclude from stream URL detection
const FALSE_POSITIVE_PATTERNS = [
    'manifest', 'service-worker', 'webmanifest', 'blank.mp4',
    'pixel', 'tracking', 'beacon', 'analytics'
];
/**
 * Check if a URL looks like a real video stream URL (not a false positive)
 */
function isVideoStreamUrl(url) {
    const lower = url.toLowerCase();
    // Exclude known false positives
    if (FALSE_POSITIVE_PATTERNS.some(p => lower.includes(p)))
        return false;
    // Exclude ad-related URLs (but be careful not to exclude "load" or "download")
    if (/[/.]ad[s]?[/.\-?]/.test(lower) || lower.includes('/adserver'))
        return false;
    // Check for video file extensions (strict matching: extension followed by ? or end)
    if (/\.mp4(\?|$)/i.test(url))
        return true;
    if (/\.m3u8(\?|$)/i.test(url))
        return true;
    if (/\.webm(\?|$)/i.test(url))
        return true;
    if (/\.ts(\?|$)/i.test(url) && lower.includes('/hls/'))
        return true;
    // videoplayback (YouTube-style direct video)
    if (lower.includes('videoplayback'))
        return true;
    // /hls/ path segments (HLS streaming)
    if (lower.includes('/hls/'))
        return true;
    // /video/ path — only match if followed by a filename-like pattern (has extension or hash)
    if (/\/video\/[^/]+\.(mp4|m3u8|webm|ts)(\?|$)/i.test(url))
        return true;
    if (/\/video\/[a-f0-9]{8,}/i.test(url) && !lower.includes('/video/manifest'))
        return true;
    return false;
}
/**
 * Dedicated extractor for desustream.info pages that embed blogger.com video player.
 * Blogger video URLs typically come from video.g?token=... endpoints.
 */
async function extractBloggerStream(page, browser) {
    try {
        // Look for blogger video iframe in all frames
        const frames = page.frames();
        let bloggerUrl = null;
        for (const frame of frames) {
            try {
                const frameUrl = frame.url();
                if (frameUrl.includes('blogger.com/video') || frameUrl.includes('video.g')) {
                    bloggerUrl = frameUrl;
                    break;
                }
            }
            catch (_e) { /* skip */ }
        }
        // Also check for blogger iframe in DOM
        if (!bloggerUrl) {
            bloggerUrl = await page.evaluate(() => {
                const iframes = Array.from(document.querySelectorAll('iframe'));
                for (const iframe of iframes) {
                    const src = iframe.getAttribute('src') || '';
                    if (src.includes('blogger.com/video') || src.includes('video.g')) {
                        return src;
                    }
                }
                return null;
            });
        }
        if (!bloggerUrl)
            return null;
        // Open blogger URL in a new page and intercept the video response
        const bloggerPage = await browser.newPage();
        try {
            await bloggerPage.setUserAgent(userAgent);
            let bloggerStreamUrl = null;
            await bloggerPage.setRequestInterception(true);
            bloggerPage.on('request', (req) => {
                req.continue();
            });
            bloggerPage.on('response', async (res) => {
                try {
                    const resUrl = res.url();
                    const contentType = res.headers()['content-type'] || '';
                    if ((resUrl.includes('video.g') || resUrl.includes('blogger.com/video')) &&
                        (contentType.includes('json') || contentType.includes('text'))) {
                        const text = await res.text();
                        // Try to extract play_url from JSON response
                        const playUrlMatch = text.match(/"play_url"\s*:\s*"(https?:[^"]+)"/);
                        if (playUrlMatch && playUrlMatch[1]) {
                            bloggerStreamUrl = playUrlMatch[1].replace(/\\u003d/g, '=').replace(/\\\//g, '/');
                            return;
                        }
                        // Try streams array format
                        const streamsMatch = text.match(/"streams"\s*:\s*\[.*?"play_url"\s*:\s*"(https?:[^"]+)"/);
                        if (streamsMatch && streamsMatch[1]) {
                            bloggerStreamUrl = streamsMatch[1].replace(/\\u003d/g, '=').replace(/\\\//g, '/');
                            return;
                        }
                        // Fallback: look for any MP4 URL in the response
                        const mp4Match = text.match(/https?:[^"'\s]*\.mp4[^"'\s]*/);
                        if (mp4Match) {
                            bloggerStreamUrl = mp4Match[0].replace(/\\\//g, '/');
                        }
                    }
                }
                catch (_e) { /* response may not be readable */ }
            });
            try {
                await bloggerPage.goto(bloggerUrl, { waitUntil: "networkidle2", timeout: 8000 });
                await new Promise(r => setTimeout(r, 1000));
            }
            catch (_e) { /* timeout okay */ }
            // Also try DOM extraction on blogger page
            if (!bloggerStreamUrl) {
                bloggerStreamUrl = await bloggerPage.evaluate(() => {
                    const video = document.querySelector('video');
                    if (video) {
                        const s = video.getAttribute('src') || video.currentSrc;
                        if (s && !s.startsWith('blob:'))
                            return s;
                    }
                    const html = document.documentElement.innerHTML;
                    const mp4Match = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
                    if (mp4Match)
                        return mp4Match[0];
                    return null;
                });
            }
            return bloggerStreamUrl;
        }
        finally {
            try {
                await bloggerPage.close();
            }
            catch (_e) { /* already closed */ }
        }
    }
    catch (_e) {
        return null;
    }
}
/**
 * Dedicated extractor for filedon.co pages.
 * filedon loads video via JS; we wait for networkidle and extract from DOM or XHR.
 */
async function extractFiledonStream(page) {
    try {
        // Wait extra time for JS to load the video
        await new Promise(r => setTimeout(r, 1500));
        // Try to get video src from DOM
        const videoSrc = await page.evaluate(() => {
            const video = document.querySelector('video');
            if (video) {
                const s = video.getAttribute('src') || video.currentSrc;
                if (s && !s.startsWith('blob:') && s.startsWith('http'))
                    return s;
                const source = video.querySelector('source');
                if (source) {
                    const ss = source.getAttribute('src');
                    if (ss && !ss.startsWith('blob:') && ss.startsWith('http'))
                        return ss;
                }
            }
            // Check data attributes that filedon might use
            const elements = Array.from(document.querySelectorAll('[data-file], [data-src], [data-video]'));
            for (const el of elements) {
                const dataFile = el.getAttribute('data-file');
                if (dataFile && dataFile.startsWith('http'))
                    return dataFile;
                const dataSrc = el.getAttribute('data-src');
                if (dataSrc && dataSrc.startsWith('http') && /\.(mp4|m3u8|webm)/i.test(dataSrc))
                    return dataSrc;
                const dataVideo = el.getAttribute('data-video');
                if (dataVideo && dataVideo.startsWith('http'))
                    return dataVideo;
            }
            // Look for download link
            const downloadLink = document.querySelector('a[href*=".mp4"], a[download]');
            if (downloadLink) {
                const href = downloadLink.getAttribute('href');
                if (href && href.startsWith('http'))
                    return href;
            }
            // Regex search in page source
            const html = document.documentElement.innerHTML;
            const mp4Match = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
            if (mp4Match)
                return mp4Match[0];
            return null;
        });
        return videoSrc;
    }
    catch (_e) {
        return null;
    }
}
export default async function extractStream(iframeUrl) {
    // Cek cache dulu
    const cached = cacheGet(iframeUrl);
    if (cached)
        return cached;
    await acquireSlot();
    let page = null;
    try {
        const browser = await getBrowser();
        page = await browser.newPage();
        const pg = page;
        await pg.setUserAgent(userAgent);
        await pg.setRequestInterception(true);
        let streamUrl = null;
        // Request interception: jangan block AD request karena banyak video player
        // modern deteksi adblock dan tampilkan "disable adblock to continue".
        // Biarkan semua request jalan, kita cukup capture video URL dari response.
        pg.on('request', (req) => {
            const url = req.url();
            // Capture video stream URLs early
            if (!streamUrl && isVideoStreamUrl(url)) {
                streamUrl = url;
            }
            req.continue();
        });
        // Response interception: capture video URLs from JSON/XHR responses
        pg.on('response', async (res) => {
            if (streamUrl)
                return; // Already found
            try {
                const resUrl = res.url();
                const contentType = res.headers()['content-type'] || '';
                const status = res.status();
                // Only process successful JSON/text responses that might contain video URLs
                if (status >= 200 && status < 300 && (contentType.includes('json') || contentType.includes('javascript'))) {
                    // Skip large or irrelevant responses
                    if (resUrl.includes('analytics') || resUrl.includes('tracking'))
                        return;
                    const text = await res.text();
                    // Look for video URLs in JSON responses
                    const videoUrlMatch = text.match(/"(?:file|url|src|source|video_url|play_url|stream_url|mp4)"\s*:\s*"(https?:[^"]+\.(?:mp4|m3u8|webm)[^"]*)"/i);
                    if (videoUrlMatch && videoUrlMatch[1]) {
                        const candidate = videoUrlMatch[1].replace(/\\\//g, '/').replace(/\\u003d/g, '=');
                        if (!FALSE_POSITIVE_PATTERNS.some(pat => candidate.toLowerCase().includes(pat))) {
                            streamUrl = candidate;
                        }
                    }
                }
            }
            catch (_e) { /* response body may not be available */ }
        });
        // Detect if this is a desustream or filedon URL for dedicated handling
        const isDesustream = iframeUrl.includes('desustream');
        const isFiledon = iframeUrl.includes('filedon');
        try {
            await pg.goto(iframeUrl, { waitUntil: "networkidle2", timeout: 12000 });
            await new Promise(r => setTimeout(r, 1500));
        }
        catch (_e) {
            // timeout is okay, we may have captured the URL already
        }
        // Dedicated extractor for desustream (blogger.com embed)
        if (!streamUrl && isDesustream) {
            streamUrl = await extractBloggerStream(pg, browser);
        }
        // Dedicated extractor for filedon.co
        if (!streamUrl && isFiledon) {
            streamUrl = await extractFiledonStream(pg);
        }
        // If no stream captured via network interception, try DOM extraction
        if (!streamUrl) {
            const src = await pg.evaluate(() => {
                // Try <video> tag
                const video = document.querySelector('video');
                if (video) {
                    const s = video.getAttribute('src') || video.currentSrc;
                    if (s && !s.startsWith('blob:'))
                        return s;
                    const source = video.querySelector('source');
                    if (source) {
                        const ss = source.getAttribute('src');
                        if (ss && !ss.startsWith('blob:'))
                            return ss;
                    }
                }
                // Try standalone <source>
                const source = document.querySelector('source');
                if (source) {
                    const ss = source.getAttribute('src');
                    if (ss && !ss.startsWith('blob:'))
                        return ss;
                }
                // Check data-file and data-src attributes
                const dataElements = Array.from(document.querySelectorAll('[data-file], [data-src], [data-video]'));
                for (const el of dataElements) {
                    const dataFile = el.getAttribute('data-file');
                    if (dataFile && dataFile.startsWith('http') && /\.(mp4|m3u8|webm)/i.test(dataFile))
                        return dataFile;
                    const dataSrc = el.getAttribute('data-src');
                    if (dataSrc && dataSrc.startsWith('http') && /\.(mp4|m3u8|webm)/i.test(dataSrc))
                        return dataSrc;
                    const dataVideo = el.getAttribute('data-video');
                    if (dataVideo && dataVideo.startsWith('http') && /\.(mp4|m3u8|webm)/i.test(dataVideo))
                        return dataVideo;
                }
                // Try jwplayer
                if (window.jwplayer) {
                    try {
                        const jw = window.jwplayer();
                        const playlist = jw.getPlaylistItem();
                        if (playlist && playlist.file)
                            return playlist.file;
                    }
                    catch (_e) { /* ignore */ }
                }
                // Try clappr or videojs
                if (window.player) {
                    try {
                        const player = window.player;
                        if (player.options_ && player.options_.sources && player.options_.sources[0]) {
                            return player.options_.sources[0].src;
                        }
                    }
                    catch (_e) { /* ignore */ }
                }
                // Try looking for m3u8/mp4 in page source
                const html = document.documentElement.innerHTML;
                const m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
                if (m3u8Match)
                    return m3u8Match[0];
                const mp4Match = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
                if (mp4Match)
                    return mp4Match[0];
                return null;
            });
            if (src && !src.startsWith('blob:')) {
                streamUrl = src;
            }
        }
        // Last resort: check iframes inside the page
        if (!streamUrl) {
            const frames = pg.frames();
            for (const frame of frames) {
                if (frame === pg.mainFrame())
                    continue;
                try {
                    const src = await frame.evaluate(() => {
                        const video = document.querySelector('video');
                        if (video) {
                            const s = video.getAttribute('src') || video.currentSrc;
                            if (s && !s.startsWith('blob:'))
                                return s;
                            const source = video.querySelector('source');
                            if (source) {
                                const ss = source.getAttribute('src');
                                if (ss && !ss.startsWith('blob:'))
                                    return ss;
                            }
                        }
                        // Check data attributes in frames too
                        const dataEl = document.querySelector('[data-file], [data-src]');
                        if (dataEl) {
                            const df = dataEl.getAttribute('data-file') || dataEl.getAttribute('data-src');
                            if (df && df.startsWith('http') && /\.(mp4|m3u8|webm)/i.test(df))
                                return df;
                        }
                        const html = document.documentElement.innerHTML;
                        const m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
                        if (m3u8Match)
                            return m3u8Match[0];
                        const mp4Match = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
                        if (mp4Match)
                            return mp4Match[0];
                        return null;
                    });
                    if (src) {
                        streamUrl = src;
                        break;
                    }
                }
                catch (_e) { /* cross-origin frame, skip */ }
            }
        }
        if (streamUrl)
            cacheSet(iframeUrl, streamUrl);
        return streamUrl;
    }
    catch (e) {
        console.error("Failed to extract stream:", e);
        return null;
    }
    finally {
        if (page) {
            try {
                await page.close();
            }
            catch (_e) { /* page may already be closed */ }
        }
        releaseSlot();
    }
}
