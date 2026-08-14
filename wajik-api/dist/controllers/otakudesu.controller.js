import otakudesuScraper from "../scrapers/otakudesu.scraper.js";
import otakudesuParser from "../parsers/otakudesu.parser.js";
import otakudesuConfig from "../configs/otakudesu.config.js";
import otakudesuSchema from "../schemas/otakudesu.schema.js";
import setPayload from "../helpers/setPayload.js";
import { validateProxyUrl } from "../helpers/validateUrl.js";
import * as v from "valibot";
const { baseUrl } = otakudesuConfig;
const otakudesuController = {
    async getRoot(req, res, next) {
        const routes = [
            {
                method: "GET",
                path: "/otakudesu/home",
                description: "Halaman utama",
                pathParams: [],
                queryParams: [],
            },
            {
                method: "GET",
                path: "/otakudesu/schedule",
                description: "Jadwal rilis",
                pathParams: [],
                queryParams: [],
            },
            {
                method: "GET",
                path: "/otakudesu/anime",
                description: "Daftar semua anime",
                pathParams: [],
                queryParams: [],
            },
            {
                method: "GET",
                path: "/otakudesu/genre",
                description: "Daftar semua genre",
                pathParams: [],
                queryParams: [],
            },
            {
                method: "GET",
                path: "/otakudesu/ongoing",
                description: "Daftar anime sedang tayang",
                pathParams: [],
                queryParams: [
                    {
                        key: "page",
                        value: "string",
                        defaultValue: "1",
                        required: false,
                    },
                ],
            },
            {
                method: "GET",
                path: "/otakudesu/completed",
                description: "Daftar anime selesai",
                pathParams: [],
                queryParams: [
                    {
                        key: "page",
                        value: "string",
                        defaultValue: "1",
                        required: false,
                    },
                ],
            },
            {
                method: "GET",
                path: "/otakudesu/search",
                description: "Daftar anime berdasarkan pencarian",
                pathParams: [],
                queryParams: [
                    {
                        key: "q",
                        value: "string",
                        defaultValue: null,
                        required: true,
                    },
                ],
            },
            {
                method: "GET",
                path: "/otakudesu/genre/{genreId}",
                description: "Daftar anime berdasarkan genre",
                pathParams: [
                    {
                        key: "genreId",
                        value: "string",
                        defaultValue: null,
                        required: true,
                    },
                ],
                queryParams: [
                    {
                        key: "page",
                        value: "string",
                        defaultValue: "1",
                        required: false,
                    },
                ],
            },
            {
                method: "GET",
                path: "/otakudesu/batch/{batchId}",
                description: "Batch anime berdasarkan id batch",
                pathParams: [
                    {
                        key: "batchId",
                        value: "string",
                        defaultValue: null,
                        required: true,
                    },
                ],
                queryParams: [],
            },
            {
                method: "GET",
                path: "/otakudesu/anime/{animeId}",
                description: "Detail anime berdasarkan id anime",
                pathParams: [
                    {
                        key: "animeId",
                        value: "string",
                        defaultValue: null,
                        required: true,
                    },
                ],
                queryParams: [],
            },
            {
                method: "GET",
                path: "/otakudesu/episode/{episodeId}",
                description: "Detail episode berdasarkan id episode",
                pathParams: [
                    {
                        key: "episodeId",
                        value: "string",
                        defaultValue: null,
                        required: true,
                    },
                ],
                queryParams: [],
            },
            {
                method: "GET | POST",
                path: "/otakudesu/server/{serverId}",
                description: "Link video berdasarkan id server",
                pathParams: [
                    {
                        key: "serverId",
                        value: "string",
                        defaultValue: null,
                        required: true,
                    },
                ],
                queryParams: [],
            },
        ];
        res.json(setPayload(res, {
            message: "Status: OK 🚀",
            data: { routes },
        }));
    },
    async getHome(req, res, next) {
        try {
            const ref = "https://google.com/";
            const document = await otakudesuScraper.scrapeDOM("/", ref);
            const home = otakudesuParser.parseHome(document);
            const payload = setPayload(res, {
                data: home,
            });
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    },
    async getSchedule(req, res, next) {
        try {
            const pathname = "/jadwal-rilis/";
            const document = await otakudesuScraper.scrapeDOM(pathname, baseUrl);
            const scheduleList = otakudesuParser.parseSchedules(document);
            const payload = setPayload(res, {
                data: { scheduleList },
            });
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    },
    async getAllAnimes(req, res, next) {
        try {
            const pathname = "/anime-list/";
            const document = await otakudesuScraper.scrapeDOM(pathname, baseUrl, true);
            const list = otakudesuParser.parseAllAnimes(document);
            const payload = setPayload(res, {
                data: { list },
            });
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    },
    async getAllGenres(req, res, next) {
        try {
            const pathname = "/genre-list/";
            const document = await otakudesuScraper.scrapeDOM(pathname, baseUrl);
            const genreList = otakudesuParser.parseAllGenres(document);
            const payload = setPayload(res, {
                data: { genreList },
            });
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    },
    async getOngoingAnimes(req, res, next) {
        try {
            const page = Number(v.parse(otakudesuSchema.query.animes, req.query)?.page);
            const pathname = page > 1 ? `/ongoing-anime/page/${page}/` : "/ongoing-anime/";
            const document = await otakudesuScraper.scrapeDOM(pathname, baseUrl);
            const animeList = otakudesuParser.parseOngoingAnimes(document);
            const pagination = otakudesuParser.parsePagination(document);
            const payload = setPayload(res, {
                data: { animeList },
                pagination,
            });
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    },
    async getCompletedAnimes(req, res, next) {
        try {
            const page = Number(v.parse(otakudesuSchema.query.animes, req.query)?.page);
            const pathname = page > 1 ? `/complete-anime/page/${page}/` : "/complete-anime/";
            const document = await otakudesuScraper.scrapeDOM(pathname, baseUrl);
            const animeList = otakudesuParser.parseCompletedAnimes(document);
            const pagination = otakudesuParser.parsePagination(document);
            const payload = setPayload(res, {
                data: { animeList },
                pagination,
            });
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    },
    async getSearchedAnimes(req, res, next) {
        try {
            const { q } = v.parse(otakudesuSchema.query.searchedAnimes, req.query);
            const pathname = `/?s=${q}&post_type=anime`;
            const document = await otakudesuScraper.scrapeDOM(pathname, baseUrl);
            let animeList = otakudesuParser.parseSearchedAnimes(document);
            // Franchise Expansion Logic: Auto-fetch related seasons for top results
            // This bypasses Otakudesu's native search limitation where sequels are missed when searching for character names
            try {
                const topResults = animeList.slice(0, 3);
                const expandedPromises = topResults.map(async (anime) => {
                    // Extract first 3 words of the base title (e.g. "Otonari no Tenshi-sama")
                    const baseTitle = anime.title.replace(/\(.*?\)/g, '').replace(/subtitle indonesia/i, '').replace(/season \d+/i, '').replace(/s\d+/i, '').trim().split(' ').slice(0, 3).join(' ');
                    if (baseTitle.length > 3 && baseTitle.toLowerCase() !== q.toLowerCase()) {
                        const expPath = `/?s=${encodeURIComponent(baseTitle)}&post_type=anime`;
                        try {
                            const expDoc = await otakudesuScraper.scrapeDOM(expPath, baseUrl);
                            return otakudesuParser.parseSearchedAnimes(expDoc);
                        }
                        catch (e) {
                            return [];
                        }
                    }
                    return [];
                });
                const expandedResults = await Promise.all(expandedPromises);
                expandedResults.forEach(resList => {
                    resList.forEach(item => {
                        if (!animeList.find(a => a.animeId === item.animeId)) {
                            animeList.push(item);
                        }
                    });
                });
            }
            catch (e) {
                // Silently ignore franchise expansion errors so search doesn't break
                console.warn("Franchise expansion failed", e);
            }
            const payload = setPayload(res, {
                data: { animeList },
            });
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    },
    async getAnimesByGenre(req, res, next) {
        try {
            const genreId = req.params.genreId;
            const page = Number(v.parse(otakudesuSchema.query.animes, req.query)?.page);
            const pathname = page > 1 ? `/genres/${genreId}/page/${page}/` : `/genres/${genreId}/`;
            const document = await otakudesuScraper.scrapeDOM(pathname, baseUrl);
            const animeList = otakudesuParser.parseAnimesByGenre(document);
            const pagination = otakudesuParser.parsePagination(document);
            const payload = setPayload(res, {
                data: { animeList },
                pagination,
            });
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    },
    async getAdvancedBrowseFilter(req, res, next) {
        try {
            const genreId = req.query.genre;
            const year = req.query.year;
            if (!genreId) {
                return res.status(400).json(setPayload(res, { message: "genre parameter is required" }));
            }
            let allAnimes = [];
            const MAX_PAGES = 5; // Fetch first 5 pages concurrently to find matches quickly
            const fetchPage = async (page) => {
                try {
                    const pathname = page > 1 ? `/genres/${genreId}/page/${page}/` : `/genres/${genreId}/`;
                    const document = await otakudesuScraper.scrapeDOM(pathname, baseUrl);
                    return otakudesuParser.parseAnimesByGenre(document);
                }
                catch (e) {
                    return [];
                }
            };
            const promises = [];
            for (let i = 1; i <= MAX_PAGES; i++) {
                promises.push(fetchPage(i));
            }
            const results = await Promise.all(promises);
            results.forEach(pageList => {
                allAnimes = [...allAnimes, ...pageList];
            });
            // Filter by year if provided. Cek beberapa field karena `season`
            // kadang kosong di beberapa anime; fallback ke releaseDate dan judul.
            if (year) {
                allAnimes = allAnimes.filter(anime => {
                    const hay = `${anime.season || ''} ${anime.releaseDate || ''} ${anime.title || ''}`;
                    return hay.includes(year);
                });
            }
            // Remove duplicates just in case
            const uniqueAnimes = [];
            const seen = new Set();
            for (const a of allAnimes) {
                if (!seen.has(a.animeId)) {
                    seen.add(a.animeId);
                    uniqueAnimes.push(a);
                }
            }
            const payload = setPayload(res, {
                data: { animeList: uniqueAnimes }
            });
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    },
    async getBatchDetails(req, res, next) {
        try {
            const batchId = req.params.batchId;
            const pathname = `/batch/${batchId}/`;
            const document = await otakudesuScraper.scrapeDOM(pathname, baseUrl);
            const details = otakudesuParser.parseBatchDetails(document);
            const payload = setPayload(res, {
                data: { details },
            });
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    },
    async getAnimeDetails(req, res, next) {
        try {
            const animeId = req.params.animeId;
            const pathname = `/anime/${animeId}/`;
            const document = await otakudesuScraper.scrapeDOM(pathname, baseUrl);
            const details = otakudesuParser.parseAnimeDetails(document);
            const payload = setPayload(res, {
                data: { details },
            });
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    },
    async getEpisodeDetails(req, res, next) {
        try {
            const episodeId = req.params.episodeId;
            const pathname = `/episode/${episodeId}/`;
            const document = await otakudesuScraper.scrapeDOM(pathname, baseUrl);
            const details = await otakudesuParser.parseEpisodeDetails(document, new URL(pathname, baseUrl).toString());
            const payload = setPayload(res, {
                data: { details },
            });
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    },
    async getServerDetails(req, res, next) {
        try {
            const serverId = req.params.serverId || "";
            const details = await otakudesuParser.parseServerDetails(serverId);
            const payload = setPayload(res, {
                data: { details },
            });
            res.json(payload);
        }
        catch (error) {
            if (error.message.includes("is not valid JSON")) {
                res.status(400).json(setPayload(res));
                return;
            }
            next(error);
        }
    },
    async resolveStream(req, res, next) {
        try {
            const serverId = req.query.serverId || "";
            if (!serverId) {
                return res.status(400).json(setPayload(res, { message: "serverId is required" }));
            }
            const details = await otakudesuParser.parseServerDetails(serverId);
            const payload = setPayload(res, {
                data: { url: details?.url || "" },
            });
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    },
    async getStreamProxy(req, res, next) {
        try {
            const targetUrl = req.query.url;
            if (!targetUrl) {
                res.status(400).send("Missing url parameter");
                return;
            }
            const { valid, reason } = validateProxyUrl(targetUrl);
            if (!valid)
                return res.status(400).json({ error: reason });
            const response = await fetch(targetUrl, {
                headers: {
                    "Referer": "https://otakudesu.blog/",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                }
            });
            let html = await response.text();
            // Inject CSS untuk memastikan iframe/video full-size (karena CSS asli mungkin gagal dimuat akibat perbedaan domain)
            const cssInjection = `<style>body{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden;background:#000;display:flex;justify-content:center;align-items:center;} iframe,video{width:100vw;height:100vh;border:none;}</style>`;
            if (html.includes('</head>')) {
                html = html.replace('</head>', `${cssInjection}</head>`);
            }
            else {
                html = cssInjection + html;
            }
            res.setHeader("Content-Type", "text/html");
            res.send(html);
        }
        catch (error) {
            next(error);
        }
    },
    async getRedirectUrl(req, res, next) {
        try {
            const targetUrl = req.query.url;
            if (!targetUrl) {
                res.status(400).send("Missing url parameter");
                return;
            }
            const { valid, reason } = validateProxyUrl(targetUrl);
            if (!valid)
                return res.status(400).json({ error: reason });
            const response = await fetch(targetUrl, {
                method: 'GET',
                redirect: 'manual', // Prevent automatic following to capture Location
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                }
            });
            // Some servers use 301/302 redirects
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                if (location) {
                    res.json(setPayload(res, { data: { url: location } }));
                    return;
                }
            }
            // If it didn't redirect or location header is missing
            res.json(setPayload(res, { data: { url: targetUrl } }));
        }
        catch (error) {
            next(error);
        }
    },
    async iframeProxy(req, res) {
        try {
            const targetUrl = req.query.url;
            if (!targetUrl) {
                res.status(400).send("Missing url parameter");
                return;
            }
            const { valid, reason } = validateProxyUrl(targetUrl);
            if (!valid)
                return res.status(400).json({ error: reason });
            console.log(`[OTAKUDESU IFRAME PROXY] Fetching embed page: ${targetUrl}`);
            const targetOrigin = new URL(targetUrl).origin;
            const renderDirectFallback = (reason) => {
                console.log(`[OTAKUDESU IFRAME PROXY] Falling back to direct embed (${reason})`);
                const safeUrl = targetUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe src="${safeUrl}" allow="autoplay;fullscreen;encrypted-media" allowfullscreen></iframe></body></html>`;
            };
            let response;
            try {
                response = await fetch(targetUrl, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Referer": "https://otakudesu.blog/",
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.9"
                    }
                });
            }
            catch (fetchErr) {
                res.setHeader("Content-Type", "text/html");
                res.setHeader("Access-Control-Allow-Origin", "*");
                return res.status(200).send(renderDirectFallback(`fetch error: ${fetchErr?.message || fetchErr}`));
            }
            if (!response.ok) {
                res.setHeader("Content-Type", "text/html");
                res.setHeader("Access-Control-Allow-Origin", "*");
                return res.status(200).send(renderDirectFallback(`upstream ${response.status}`));
            }
            const html = await response.text();
            if (!html || html.length < 200) {
                res.setHeader("Content-Type", "text/html");
                res.setHeader("Access-Control-Allow-Origin", "*");
                return res.status(200).send(renderDirectFallback("empty or tiny response"));
            }
            const { parse } = await import("node-html-parser");
            const root = parse(html);
            // Blocked ad domains
            const blockedAdDomains = [
                "googlesyndication",
                "doubleclick",
                "googleadservices",
                "popads",
                "adsterra",
                "exoclick",
                "juicyads",
                "propellerads",
                "hilltopads",
                "clickadu",
                "mgid.com",
                "taboola",
                "outbrain",
                "histats.com"
            ];
            // Process scripts: block ad scripts, fix relative URLs
            const scripts = root.querySelectorAll("script");
            scripts.forEach((script) => {
                const src = script.getAttribute("src");
                if (src) {
                    const isBlocked = blockedAdDomains.some((domain) => src.toLowerCase().includes(domain));
                    if (isBlocked) {
                        script.setAttribute("src", "about:blank");
                        script.setAttribute("data-blocked", "1");
                        return;
                    }
                    // Fix relative URLs
                    if (src.startsWith("/") && !src.startsWith("//")) {
                        script.setAttribute("src", `${targetOrigin}${src}`);
                    }
                    else if (!src.startsWith("http") && !src.startsWith("//")) {
                        script.setAttribute("src", `${targetOrigin}/${src}`);
                    }
                }
                else {
                    // Remove inline popunder scripts
                    const content = script.text || "";
                    const lower = content.toLowerCase();
                    if (lower.includes("window.open") && (lower.includes("popunder") || lower.includes("redirect"))) {
                        script.remove();
                    }
                }
            });
            // Fix relative link hrefs
            const links = root.querySelectorAll("link[rel='stylesheet']");
            links.forEach((link) => {
                const href = link.getAttribute("href");
                if (href) {
                    if (href.startsWith("/") && !href.startsWith("//")) {
                        link.setAttribute("href", `${targetOrigin}${href}`);
                    }
                    else if (!href.startsWith("http") && !href.startsWith("//")) {
                        link.setAttribute("href", `${targetOrigin}/${href}`);
                    }
                }
            });
            // Inject fullscreen CSS + anti-popup script
            const head = root.querySelector("head");
            if (head) {
                head.insertAdjacentHTML("afterbegin", `<style>body{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden;background:#000}video,iframe{width:100vw;height:100vh;border:0}</style><script>window.open=function(){return null};window.alert=function(){};</script>`);
            }
            else {
                // No <head>, prepend to root
                const injection = `<style>body{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden;background:#000}video,iframe{width:100vw;height:100vh;border:0}</style><script>window.open=function(){return null};window.alert=function(){};</script>`;
                const finalHtml = injection + root.toString();
                res.setHeader("Content-Type", "text/html");
                res.setHeader("Access-Control-Allow-Origin", "*");
                return res.status(200).send(finalHtml);
            }
            res.setHeader("Content-Type", "text/html");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.status(200).send(root.toString());
        }
        catch (error) {
            console.error("[OTAKUDESU IFRAME PROXY] Error:", error?.message || error);
            const targetUrl = req.query.url || "";
            const safeUrl = targetUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const fallback = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe src="${safeUrl}" allow="autoplay;fullscreen;encrypted-media" allowfullscreen></iframe></body></html>`;
            res.setHeader("Content-Type", "text/html");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.status(200).send(fallback);
        }
    },
    async getAggregateStream(req, res, next) {
        try {
            const episodeId = req.params.episodeId;
            if (!episodeId) {
                return res.status(400).json(setPayload(res, { message: "episodeId is required" }));
            }
            // Fetch episode details to get download section
            const pathname = `/episode/${episodeId}/`;
            const document = await otakudesuScraper.scrapeDOM(pathname, baseUrl);
            const details = await otakudesuParser.parseEpisodeDetails(document, new URL(pathname, baseUrl).toString());
            const streams = [];
            // Extract all resolutions from download section (especially 1080p+)
            if (details.download && details.download.qualityList) {
                for (const quality of details.download.qualityList) {
                    const title = quality.title || "";
                    // Find PixelDrain links (most reliable for streaming)
                    const pdrainLink = quality.urlList?.find((u) => u.title?.toLowerCase().includes('pdrain') || u.title?.toLowerCase().includes('pixeldrain'));
                    if (pdrainLink && pdrainLink.url) {
                        try {
                            // Resolve the redirect to get actual PixelDrain URL
                            const redirectResponse = await fetch(pdrainLink.url, {
                                method: 'GET',
                                redirect: 'manual',
                                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
                            });
                            let finalUrl = pdrainLink.url;
                            if (redirectResponse.status >= 300 && redirectResponse.status < 400) {
                                finalUrl = redirectResponse.headers.get('location') || finalUrl;
                            }
                            // Convert pixeldrain.com/u/ID to pixeldrain.com/api/file/ID
                            const pdMatch = finalUrl.match(/pixeldrain\.com\/u\/([a-zA-Z0-9_-]+)/);
                            if (pdMatch && pdMatch[1]) {
                                streams.push({
                                    quality: title,
                                    url: `https://pixeldrain.com/api/file/${pdMatch[1]}`,
                                    source: "Otakudesu (PixelDrain)",
                                    type: "direct"
                                });
                            }
                        }
                        catch (e) {
                            console.warn(`Failed to resolve Pdrain link for ${title}:`, e);
                        }
                    }
                    // Also try GoFile, Acefile, etc. as fallback
                    const gofileLink = quality.urlList?.find((u) => u.title?.toLowerCase().includes('gofile'));
                    if (gofileLink && gofileLink.url) {
                        streams.push({
                            quality: title,
                            url: gofileLink.url,
                            source: "Otakudesu (GoFile)",
                            type: "redirect"
                        });
                    }
                }
            }
            // Also include server/stream options
            if (details.server && details.server.qualityList) {
                for (const quality of details.server.qualityList) {
                    const title = quality.title || "";
                    for (const server of (quality.serverList || [])) {
                        streams.push({
                            quality: title,
                            serverId: server.serverId,
                            serverName: server.title,
                            source: "Otakudesu (Stream)",
                            type: "embed"
                        });
                    }
                }
            }
            const payload = setPayload(res, {
                data: { streams }
            });
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    },
};
export default otakudesuController;
