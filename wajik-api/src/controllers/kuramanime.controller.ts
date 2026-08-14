import type { Request, Response } from "express";
import kuramanimeParser from "@parsers/kuramanime.parser.js";
import setPayload from "@helpers/setPayload.js";
import getHTMLViaFlareSolverr from "@helpers/getHTMLViaFlareSolverr.js";
import { validateProxyUrl } from "@helpers/validateUrl.js";

const kuramanimeController = {
  async search(req: Request, res: Response) {
    const query = req.query.q as string;
    const page = parseInt(req.query.page as string) || 1;
    // Allow empty query for fetching latest

    try {
      const searchPromise = kuramanimeParser.parseSearch(query, page);
      const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Search timeout")), 20000));
      const results = await Promise.race([searchPromise, timeoutPromise]);
      return res.status(200).json(setPayload(res, { data: { animeList: results } }));
    } catch (e) {
      console.error("Search failed:", e);
      // Return empty list instead of 500 so frontend can fallback to other sources
      return res.status(200).json(setPayload(res, { data: { animeList: [] } }));
    }
  },

  // /kuramanime/latest?page=1 -> /anime?order_by=updated&page=N. Backed by
  // parseCustom which renders the same card layout (poster + score) used by
  // search results, but always returns the latest 30 ongoing entries.
  async latest(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || 1;
    try {
      const p = kuramanimeParser.parseCustom(`/anime?order_by=updated&page=${page}`);
      const t = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Latest timeout")), 20000));
      const results = await Promise.race([p, t]);
      return res.status(200).json(setPayload(res, { data: { animeList: results } }));
    } catch (e) {
      console.error("Latest failed:", e);
      return res.status(200).json(setPayload(res, { data: { animeList: [] } }));
    }
  },

  async schedule(req: Request, res: Response) {
    try {
      const scheduleList = await kuramanimeParser.parseSchedule();
      return res.status(200).json(setPayload(res, { data: { scheduleList } }));
    } catch (e) {
      console.error("Schedule failed:", e);
      return res.status(200).json(setPayload(res, { data: { scheduleList: [] } }));
    }
  },

  // /kuramanime/live-search?q=... — autocomplete cepat. Cuma return top 8
  // dari card mode (skip text mode supaya 1 request saja). Cache 5 menit.
  async liveSearch(req: Request, res: Response) {
    try {
      const q = String(req.query.q || "").trim();
      if (!q || q.length < 2) {
        return res.status(200).json(setPayload(res, { data: { items: [] } }));
      }
      const list = await kuramanimeParser.parseSearch(q, 1);
      const items = (list || []).slice(0, 8).map((a: any) => ({
        animeId: a.animeId,
        title: a.title,
        poster: a.poster,
        score: a.score,
      }));
      return res.status(200).json(setPayload(res, { data: { items } }));
    } catch (e) {
      return res.status(500).json(setPayload(res, { message: "live-search failed" }));
    }
  },

  // /kuramanime/genres → daftar genre Kurama untuk filter Browse.
  async genres(_req: Request, res: Response) {
    try {
      const list = await kuramanimeParser.parseGenres();
      return res.status(200).json(setPayload(res, { data: { genreList: list } }));
    } catch (e) {
      console.error("Genres failed:", e);
      // Return empty list instead of error to prevent frontend crash
      return res.status(200).json(setPayload(res, { data: { genreList: [] } }));
    }
  },

  // /kuramanime/browse?genre=...&year=...&order_by=latest&page=1
  // Mendukung filter multi-genre (genre=action,romance) dan multi-tahun.
  async browse(req: Request, res: Response) {
    try {
      const splitCsv = (v: any): string[] =>
        String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
      const genres = splitCsv(req.query.genre);
      const years = splitCsv(req.query.year);
      const orderBy = String(req.query.order_by || "latest");
      const page = parseInt(req.query.page as string) || 1;
      const list = await kuramanimeParser.parseBrowse({ genres, years, orderBy, page });
      return res.status(200).json(setPayload(res, { data: { animeList: list } }));
    } catch (e) {
      console.error("Browse failed:", e);
      // Return empty list instead of error to prevent frontend crash
      return res.status(200).json(setPayload(res, { data: { animeList: [] } }));
    }
  },

  async animeDetails(req: Request, res: Response) {
    // Because Kuramanime IDs contain slashes (e.g. 185/naruto), express params might cut off.
    // Instead of req.params.id, use wildcard or just take from req.params[0] if mounted properly.
    // Assuming we use encoded IDs from frontend.
    const id = req.params.id || req.params[0];
    if (!id) return res.status(400).json(setPayload(res, { message: "ID is required" }));

    try {
      const details = await kuramanimeParser.parseAnimeDetails(id);
      if (!details) return res.status(404).json(setPayload(res, { message: "Not found" }));
      return res.status(200).json(setPayload(res, { data: { details } }));
    } catch (e) {
      return res.status(500).json(setPayload(res, { message: "Failed to get anime details" }));
    }
  },

  async episodeDetails(req: Request, res: Response) {
    const id = req.params.id || req.params[0];
    if (!id) return res.status(400).json(setPayload(res, { message: "ID is required" }));

    const cacheKey = `episodeDetails:${id}`;
    const cached = (global as any).__streamCache?.get(cacheKey);
    if (cached) return res.status(200).json(setPayload(res, { data: { details: cached } }));

    try {
      const details = await kuramanimeParser.parseEpisodeDetails(id);
      if (!details) return res.status(404).json(setPayload(res, { message: "Not found" }));

      if (!(global as any).__streamCache) (global as any).__streamCache = new Map();
      (global as any).__streamCache.set(cacheKey, details);
      setTimeout(() => (global as any).__streamCache?.delete(cacheKey), 5 * 60 * 1000);

      return res.status(200).json(setPayload(res, { data: { details } }));
    } catch (e) {
      return res.status(500).json(setPayload(res, { message: "Failed to get episode details" }));
    }
  },

  async resolveStream(req: Request, res: Response) {
    const serverId = req.query.serverId as string;
    if (!serverId) return res.status(400).json(setPayload(res, { message: "serverId is required" }));

    // Cache untuk menghindari duplicate FlareSolverr call
    const cacheKey = `resolveStream:${serverId}`;
    const cached = (global as any).__streamCache?.get(cacheKey);
    if (cached) {
      return res.status(200).json(setPayload(res, { data: { url: cached } }));
    }

    try {
      let epId = serverId;
      try {
        const u = new URL(serverId);
        epId = u.pathname.replace(/^\/anime\//, "").replace(/^\//, "") + (u.search || "");
      } catch {}

      let url = "";
      try {
        const details: any = await kuramanimeParser.parseEpisodeDetails(epId);
        url = (details && (details.defaultStreamingUrl || details.streamingUrl)) || "";
        if (!url && Array.isArray(details?.serverList) && details.serverList.length > 0) {
          url = details.serverList[0].serverId || "";
        }
      } catch (e) {
        console.warn("[kuramanime resolveStream] parseEpisodeDetails fallback:", e);
      }

      if (!url) {
        try { url = (await kuramanimeParser.parseStreamUrl(serverId)) || ""; } catch {}
      }

      if (!url || url === "No iframe found") {
        return res.status(404).json(setPayload(res, { message: "Not found" }));
      }

      // Simpan ke cache
      if (!(global as any).__streamCache) (global as any).__streamCache = new Map();
      (global as any).__streamCache.set(cacheKey, url);
      setTimeout(() => (global as any).__streamCache?.delete(cacheKey), 5 * 60 * 1000);

      return res.status(200).json(setPayload(res, { data: { url } }));
    } catch (e) {
      return res.status(500).json(setPayload(res, { message: "Failed to resolve stream" }));
    }
  },

  async streamProxy(req: Request, res: Response) {
    try {
      const targetUrl = req.query.url as string;
      if (!targetUrl) return res.status(400).send("Missing URL");

      const { valid, reason } = validateProxyUrl(targetUrl);
      if (!valid) return res.status(400).json({ error: reason });

      console.log(`[PROXY] Incoming request for: ${targetUrl}`);
      console.log(`[PROXY] Range Header: ${req.headers.range}`);

      const headers: Record<string, string> = {
        "User-Agent": (req.headers["user-agent"] as string) || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://v18.kuramanime.ing/"
      };

      if (req.headers.range) {
        headers["Range"] = req.headers.range;
      }

      const abortController = new AbortController();
      req.on('close', () => {
        try { abortController.abort(); } catch(e) {}
      });

      const response = await fetch(targetUrl, { 
        headers,
        signal: abortController.signal
      });

      console.log(`[PROXY] Upstream status: ${response.status}`);
      
      res.status(response.status);
      
      // Copy over headers except those that might force download or break CORS
      response.headers.forEach((value, key) => {
        const k = key.toLowerCase();
        if (k !== 'content-disposition' && k !== 'access-control-allow-origin' && k !== 'x-frame-options') {
          res.setHeader(key, value);
        }
      });
      
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

      console.log(`[PROXY] Piping response body...`);
      if (response.body) {
        console.log(`[PROXY] Piping response body...`);
        const { Readable } = await import('stream');
        // @ts-ignore
        const readable = Readable.fromWeb(response.body);
        readable.on('error', (err) => {
          console.log(`[PROXY] Stream error (client closed): ${err.message}`);
        });
        readable.pipe(res);
      } else {
        res.end();
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.log(`[PROXY] Fetch aborted because client disconnected`);
        return;
      }
      console.error("Stream Proxy Error:", e);
      if (!res.headersSent) {
        res.status(500).send("Stream error");
      }
    }
  },

  async iframeProxy(req: Request, res: Response) {
    try {
      const targetUrl = req.query.url as string;
      if (!targetUrl) return res.status(400).send("Missing URL");

      const { valid, reason } = validateProxyUrl(targetUrl);
      if (!valid) return res.status(400).json({ error: reason });

      console.log(`[IFRAME PROXY] Fetching player page: ${targetUrl}`);
      const kuramanimeConfig = (await import("@configs/kuramanime.config.js")).default;
      const baseUrl = kuramanimeConfig.baseUrl;

      const fullUrl = new URL(targetUrl, baseUrl).toString();
      const html = await getHTMLViaFlareSolverr(fullUrl);

      // Parse HTML to strip ads and fix relative URLs
      const { parse } = await import("node-html-parser");

      const root = parse(html);

      // Blocked ad domains list
      const blockedAdDomains = [
        'bontrilou.com', 'hilltopads.com', 'adsterra.com', 'propellerads.com', 
        'juicyads', 'exoclick', 'popads', 'popunder', 'clickadu', 
        'googlesyndication', 'doubleclick', 'googleadservices', 'analytics', 
        'facebook.com', 'telegram.org', 'histats.com', 'coinhive', 'crypto-loot'
      ];

      // Clean scripts
      const scripts = root.querySelectorAll("script");
      scripts.forEach(script => {
        const src = script.getAttribute("src");
        if (src) {
          // If the script is from a blocked ad domain, remove it
          const isBlocked = blockedAdDomains.some(domain => src.toLowerCase().includes(domain));
          if (isBlocked) {
            script.remove();
            return;
          }

          // If the script is relative, make it absolute pointing to Kuramanime's baseUrl
          if (src.startsWith("/") && !src.startsWith("//")) {
            script.setAttribute("src", `${baseUrl}${src}`);
          } else if (!src.startsWith("http") && !src.startsWith("//")) {
            script.setAttribute("src", `${baseUrl}/${src}`);
          }
        } else {
          // Inline script ad check
          const content = script.text || "";
          const isAdScript = blockedAdDomains.some(domain => content.toLowerCase().includes(domain)) ||
                            content.includes("window.open") && (content.includes("popunder") || content.includes("redirect"));
          if (isAdScript) {
            script.remove();
          }
        }
      });

      // Clean link stylesheets
      const links = root.querySelectorAll("link[rel='stylesheet']");
      links.forEach(link => {
        const href = link.getAttribute("href");
        if (href) {
          if (href.startsWith("/") && !href.startsWith("//")) {
            link.setAttribute("href", `${baseUrl}${href}`);
          } else if (!href.startsWith("http") && !href.startsWith("//")) {
            link.setAttribute("href", `${baseUrl}/${href}`);
          }
        }
      });

      // Clean anchor overlays pointing to ads
      const anchors = root.querySelectorAll("a");
      anchors.forEach(a => {
        const href = a.getAttribute("href");
        if (href && ((href.startsWith("http") && !href.includes("kuramanime") && !href.includes("javascript")) || href.includes("onclick"))) {
          // Shady external link overlays
          a.setAttribute("href", "#");
          a.removeAttribute("target");
        }
      });

      // Inject strong ad-blocking scripts at the top of <head>
      const head = root.querySelector("head");
      if (head) {
        head.insertAdjacentHTML("afterbegin", `
          <script>
            // Overwrite popup windows
            window.open = function() { console.log('[PROXY] Blocked popunder window'); return null; };
            window.alert = function(msg) { console.log('[PROXY] Alert blocked: ' + msg); };
            
            // Prevent dynamic ad script insertion
            const originalCreateElement = document.createElement;
            document.createElement = function(tagName) {
              const element = originalCreateElement.call(document, tagName);
              if (tagName.toLowerCase() === 'script') {
                const originalSetAttribute = element.setAttribute;
                element.setAttribute = function(name, value) {
                  if (name.toLowerCase() === 'src') {
                    const blocked = ['bontrilou', 'hilltopads', 'adsterra', 'propellerads', 'popads', 'clickadu', 'analytics', 'doubleclick'].some(d => value.toLowerCase().includes(d));
                    if (blocked) {
                      console.log('[PROXY] Blocked dynamic script insertion: ' + value);
                      return;
                    }
                  }
                  originalSetAttribute.call(element, name, value);
                };
                
                Object.defineProperty(element, 'src', {
                  set: function(value) {
                    const blocked = ['bontrilou', 'hilltopads', 'adsterra', 'propellerads', 'popads', 'clickadu', 'analytics', 'doubleclick'].some(d => value.toLowerCase().includes(d));
                    if (blocked) {
                      console.log('[PROXY] Blocked dynamic script src: ' + value);
                      return;
                    }
                    element.setAttribute('src', value);
                  },
                  get: function() {
                    return element.getAttribute('src');
                  }
                });
              }
              return element;
            };
          </script>
        `);
      }

      res.setHeader("Content-Type", "text/html");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).send(root.toString());
    } catch (e) {
      console.error("[IFRAME PROXY ERROR]:", e);
      return res.status(500).send("Iframe proxy error");
    }
  }
};

export default kuramanimeController;
