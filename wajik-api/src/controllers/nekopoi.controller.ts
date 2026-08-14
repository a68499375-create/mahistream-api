import express from "express";
type Request = express.Request;
type Response = express.Response;
import nekopoiScraper from "../scrapers/nekopoi.scraper.js";
import nekopoiParser from "../parsers/nekopoi.parser.js";
import setPayload from "../helpers/setPayload.js";
import extractStream from "../helpers/extractStream.js";
import { validateProxyUrl } from "../helpers/validateUrl.js";

const nekopoiController = {
  async latest(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const html = await nekopoiScraper.getLatest(page);
      const data = nekopoiParser.parseLatest(html);
      console.log(`[NEKOPOI CONTROLLER] latest page=${page} -> ${data.length} items`);
      return res.json(setPayload(res, { data }));
    } catch (e: any) {
      console.error("[NEKOPOI CONTROLLER] latest error:", e?.message || e);
      return res.status(500).json(setPayload(res, { message: e.message || "Failed to get latest nekopoi" }));
    }
  },

  async search(req: Request, res: Response) {
    const q = req.query.q as string;
    if (!q) return res.status(400).json(setPayload(res, { message: "query 'q' is required" }));
    const page = parseInt(req.query.page as string) || 1;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const html = await nekopoiScraper.getSearch(q, page);
        const data = nekopoiParser.parseSearch(html);
        console.log(`[NEKOPOI CONTROLLER] search q="${q}" page=${page} -> ${data.length} items`);
        return res.json(setPayload(res, { data }));
      } catch (e: any) {
        if (attempt === 0) {
          console.warn(`[NEKOPOI CONTROLLER] search failed (attempt 1), retrying in 2s...`, e?.message);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        console.error("[NEKOPOI CONTROLLER] search error:", e?.message || e);
        return res.status(500).json(setPayload(res, { message: e.message || "Failed to search nekopoi" }));
      }
    }
  },

  // Listing per kategori dari nekopoi.care/category/<slug>/. Slug default
  // "hentai" supaya halaman Khusus tab Hentai bisa langsung memakai data
  // ini tanpa perlu menggabung beberapa search keyword.
  async category(req: Request, res: Response) {
    try {
      const slug = String(req.query.slug || "hentai");
      const page = parseInt(req.query.page as string) || 1;
      try {
        const html = await nekopoiScraper.getCategory(slug, page);
        const data = nekopoiParser.parseLatest(html);
        console.log(`[NEKOPOI CONTROLLER] category slug="${slug}" page=${page} -> ${data.length} items`);
        return res.json(setPayload(res, { data }));
      } catch (catErr: any) {
        // Fallback: kalau Cloudflare/origin block kategori spesifik (paling
        // sering "hentai" return ERR_EMPTY_RESPONSE), gunakan endpoint
        // search dengan keyword yang sama. Hasil tidak identik tapi cukup
        // untuk mengisi grid tanpa user lihat tab kosong.
        console.warn(`[NEKOPOI CONTROLLER] category "${slug}" failed, fallback to search`, catErr?.message);
        const fallbackQuery = slug.replace(/-/g, ' ');
        const searchHtml = await nekopoiScraper.getSearch(fallbackQuery, page);
        const data = nekopoiParser.parseSearch(searchHtml);
        console.log(`[NEKOPOI CONTROLLER] category fallback search="${fallbackQuery}" -> ${data.length} items`);
        return res.json(setPayload(res, { data }));
      }
    } catch (e: any) {
      console.error("[NEKOPOI CONTROLLER] category error:", e?.message || e);
      return res.status(500).json(setPayload(res, { message: e.message || "Failed to get category nekopoi" }));
    }
  },

  // Index list: /hentai-list/, /jav-list/, /genre-list/ — daftar A-Z atau
  // genre. Parser-nya berbeda dari latest karena halaman index berisi link
  // saja (tidak ada poster). Untuk MVP, kita ekstrak semua anchor di
  // halaman lalu kelompokkan berdasarkan huruf pertama.
  async index(req: Request, res: Response) {
    const path = String(req.query.path || "hentai-list");

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const html = await nekopoiScraper.getIndex(path);
        const data = nekopoiParser.parseIndexList(html);
        console.log(`[NEKOPOI CONTROLLER] index path="${path}" -> ${data.length} items`);
        return res.json(setPayload(res, { data }));
      } catch (e: any) {
        if (attempt === 0) {
          console.warn(`[NEKOPOI CONTROLLER] index failed (attempt 1), retrying in 2s...`, e?.message);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        console.error("[NEKOPOI CONTROLLER] index error:", e?.message || e);
        return res.status(500).json(setPayload(res, { message: e.message || "Failed to get index nekopoi" }));
      }
    }
  },

  async detail(req: Request, res: Response) {
    try {
      const url = req.query.url as string;
      if (!url) return res.status(400).json(setPayload(res, { message: "url parameter is required" }));
      const html = await nekopoiScraper.getDetail(url);
      const data = nekopoiParser.parseDetail(html, url);
      console.log(`[NEKOPOI CONTROLLER] detail url=${url} streams=${data.streamLinks?.length || 0} downloads=${data.downloadLinks?.length || 0}`);
      return res.json(setPayload(res, { data: { details: data } }));
    } catch (e: any) {
      console.error("[NEKOPOI CONTROLLER] detail error:", e?.message || e);
      return res.status(500).json(setPayload(res, { message: e.message || "Failed to get detail nekopoi" }));
    }
  },

  async stream(req: Request, res: Response) {
    try {
      const serverId = req.query.serverId as string;
      if (!serverId) return res.status(400).json(setPayload(res, { message: "serverId is required" }));

      // Cepat: kalau URL sudah merupakan stream langsung (.mp4/.m3u8), pakai
      // langsung tanpa menjalankan Puppeteer (yang biasa makan 10-20 detik).
      if (/\.(mp4|m3u8)(\?|$)/i.test(serverId)) {
        return res.status(200).json(setPayload(res, { data: { url: serverId } }));
      }

      // Untuk URL embed yang belum jelas, coba ekstrak dengan Puppeteer namun
      // batasi waktunya 8 detik. Kalau gagal/lambat, jatuh kembali ke URL asal
      // supaya frontend bisa langsung memutarnya lewat /nekopoi/iframe-proxy
      // (versi ad-stripped). Ini menghilangkan tampilan "loading lama" pada
      // konten Nekopoi.
      const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
        Promise.race<any>([
          p,
          new Promise((resolve) => setTimeout(() => resolve(null), ms))
        ]);

      const directStreamUrl = await withTimeout(extractStream(serverId), 8000);
      return res.status(200).json(setPayload(res, { data: { url: directStreamUrl || serverId } }));
    } catch (e: any) {
      return res.status(500).json(setPayload(res, { message: "Failed to resolve stream" }));
    }
  },

  async iframeProxy(req: Request, res: Response) {
    try {
      const targetUrl = req.query.url as string;
      if (!targetUrl) return res.status(400).send("Missing URL");

      const { valid, reason } = validateProxyUrl(targetUrl);
      if (!valid) return res.status(400).json({ error: reason });

      console.log(`[NEKOPOI IFRAME PROXY] Fetching embed page: ${targetUrl}`);

      const targetOrigin = new URL(targetUrl).origin;

      // Fallback HTML: when our server can't reach the upstream embed (403,
      // network error, etc.) we render a minimal wrapper that lets the user's
      // mobile WebView load the embed URL DIRECTLY. The WebView has its own
      // cookies, browser-like user-agent and isn't on the upstream's IP block
      // list, so it usually works even when our backend gets refused.
      const renderDirectFallback = (reason: string) => {
        console.log(`[NEKOPOI IFRAME PROXY] Falling back to direct WebView embed (${reason})`);
        const safeUrl = targetUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000}[class*="ad-"],[id*="ad-"],[class*="banner"],.pop-up,.popup,.overlay-ad,[class*="sponsor"],div[onclick*="window.open"]{display:none!important}</style><script>window.open=function(){return null};window.alert=function(){};window.confirm=function(){return true};window.prompt=function(){return ''};</script></head><body><iframe src="${safeUrl}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="no-referrer"></iframe></body></html>`;
      };

      let response: any;
      try {
        response = await fetch(targetUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Referer: "https://nekopoi.care/",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"
          }
        });
      } catch (fetchErr: any) {
        res.setHeader("Content-Type", "text/html");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(200).send(renderDirectFallback(`fetch error: ${fetchErr?.message || fetchErr}`));
      }

      if (!response.ok) {
        console.error(`[NEKOPOI IFRAME PROXY] Upstream status ${response.status}`);
        // Upstream rejected our server (commonly 403 for playmogo / streampoi).
        // Hand off to the WebView so the user's own browser session can load it.
        res.setHeader("Content-Type", "text/html");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(200).send(renderDirectFallback(`upstream ${response.status}`));
      }

      const html = await response.text();

      // Some hosts (e.g. playmogo) reply 200 but with a near-empty challenge
      // page that has no <video> / <iframe>. Detect that and fall back too.
      if (!html || html.length < 800 || (!/<video[\s>]/i.test(html) && !/<iframe[\s>]/i.test(html))) {
        res.setHeader("Content-Type", "text/html");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(200).send(renderDirectFallback("upstream html had no player tags"));
      }

      const { parse } = await import("node-html-parser");
      const root = parse(html);

      // Blocked ad domains list. PENTING: tag <script src=...> dari domain ini
      // tetap dibiarkan ada di DOM (cuma di-rewrite ke about:blank di bawah)
      // supaya anti-adblock detection tidak melihat tag-nya hilang. Permintaan
      // network yang berbahaya diblokir di sisi spoof script bawah, BUKAN
      // dengan menghapus elemen.
      const blockedAdDomains = [
        "googlesyndication",
        "doubleclick",
        "googleadservices",
        "adservice",
        "adsense",
        "popads",
        "popunder",
        "adnxs",
        "adsrv",
        "adsterra",
        "exoclick",
        "juicyads",
        "trafficjunky",
        "propellerads",
        "hilltopads",
        "clickadu",
        "richpush",
        "pushnami",
        "mgid.com",
        "taboola",
        "outbrain",
        "revcontent",
        "bontrilou",
        "histats.com",
        "coinhive",
        "crypto-loot",
        "tsartech.g",
        "syndication",
        "betterads",
        "landingtrack",
        "a-ads.com",
        "monetag",
        "pushground",
        "pushwoosh",
        "onclickmax",
        "acint.net",
        "adskeeper"
      ];

      // Untuk script tag dengan src ad-domain: JANGAN hapus elemennya (banyak
      // publisher men-detect missing tag). Ganti src ke about:blank supaya
      // browser tidak benar-benar load ad-nya, tapi tag tetap kelihatan di DOM.
      const scripts = root.querySelectorAll("script");
      scripts.forEach((script) => {
        const src = script.getAttribute("src");
        if (src) {
          const isBlocked = blockedAdDomains.some((domain) =>
            src.toLowerCase().includes(domain)
          );
          if (isBlocked) {
            // Replace src dengan about:blank — tag tetap ada (anti-adblock
            // checker tidak detect missing element), tapi tidak ada request
            // network ke ad-server yang berarti tidak ada popunder/redirect.
            script.setAttribute("src", "about:blank");
            script.setAttribute("data-blocked", "1");
            return;
          }

          // Make relative script URLs absolute, anchored to the embed origin.
          if (src.startsWith("/") && !src.startsWith("//")) {
            script.setAttribute("src", `${targetOrigin}${src}`);
          } else if (!src.startsWith("http") && !src.startsWith("//")) {
            script.setAttribute("src", `${targetOrigin}/${src}`);
          }
        } else {
          // Inline script: hanya buang yang JELAS popunder. Inline anti-adblock
          // detection (mis. cek window.adsbygoogle.loaded) malah dibiarkan
          // jalan — script spoof di bawah sudah mempersiapkan globals supaya
          // detection lolos.
          const content = script.text || "";
          const lower = content.toLowerCase();
          const hasPopunder =
            lower.includes("window.open") &&
            (lower.includes("popunder") || lower.includes("redirect"));
          if (hasPopunder) {
            script.remove();
          }
        }
      });

      // Clean link stylesheets (anchor relative URLs to embed origin)
      const links = root.querySelectorAll("link[rel='stylesheet']");
      links.forEach((link) => {
        const href = link.getAttribute("href");
        if (href) {
          if (href.startsWith("/") && !href.startsWith("//")) {
            link.setAttribute("href", `${targetOrigin}${href}`);
          } else if (!href.startsWith("http") && !href.startsWith("//")) {
            link.setAttribute("href", `${targetOrigin}/${href}`);
          }
        }
      });

      // Strip fixed width/height attributes and inline sizing from video/iframe
      // tags so our injected CSS can stretch them to fill the player container.
      const sizedTags = root.querySelectorAll(
        "video, iframe, object, embed, source"
      );
      sizedTags.forEach((el) => {
        el.removeAttribute("width");
        el.removeAttribute("height");
        const style = el.getAttribute("style");
        if (style) {
          const cleaned = style
            .replace(/(?:^|;)\s*(?:max-)?width\s*:\s*[^;]+/gi, "")
            .replace(/(?:^|;)\s*(?:max-)?height\s*:\s*[^;]+/gi, "")
            .replace(/^\s*;+/, "")
            .trim();
          if (cleaned) {
            el.setAttribute("style", cleaned);
          } else {
            el.removeAttribute("style");
          }
        }
      });

      // Neutralize external anchors that would navigate the user away.
      const anchors = root.querySelectorAll("a");
      anchors.forEach((a) => {
        const href = a.getAttribute("href");
        if (!href) return;
        if (href.startsWith("http")) {
          let sameOrigin = false;
          try {
            sameOrigin = new URL(href).origin === targetOrigin;
          } catch (_) {
            sameOrigin = false;
          }
          if (!sameOrigin) {
            a.setAttribute("href", "#");
            a.removeAttribute("target");
          }
        }
      });

      // Inject ad-blocking + popup-blocking shim at top of <head>.
      const head = root.querySelector("head");
      if (head) {
        head.insertAdjacentHTML(
          "afterbegin",
          `
          <style id="__nekopoi_proxy_fit__">
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              width: 100% !important;
              height: 100% !important;
              background: #000 !important;
              overflow: hidden !important;
            }
            video, iframe, object, embed,
            .jw-video, .jwplayer, .jw-wrapper, .jw-media,
            .video-js, .vjs-tech,
            .plyr, .plyr__video-wrapper, .plyr video,
            .player-wrapper, .video-container, .video-wrapper,
            #player, #player-container, #video, #videoContainer,
            #vjs_video_3, #my-video {
              width: 100% !important;
              height: 100% !important;
              min-width: 100% !important;
              min-height: 100% !important;
              max-width: none !important;
              max-height: none !important;
              position: absolute !important;
              top: 0 !important;
              left: 0 !important;
              right: 0 !important;
              bottom: 0 !important;
              margin: 0 !important;
              padding: 0 !important;
              display: block !important;
              box-sizing: border-box !important;
            }
            video {
              object-fit: contain !important;
              background: #000 !important;
            }
            /* Sembunyikan overlay anti-adblock dengan paksa, tanpa menghapus
               elemen lain yang sah. Selector cukup spesifik supaya tidak
               kena tag <video>/<iframe>. PENTING: kita TIDAK menyembunyikan
               elemen .ads/.adsbygoogle karena banyak detector cek visibilitas
               elemen tsb — kalau tersembunyi, detector trigger overlay.
               Kita biarkan kelihatan tapi disetel transparan. */
            [id*="adblock" i][class*="overlay" i],
            [class*="adblock" i][class*="overlay" i],
            [id*="adb-detect" i],
            [class*="adb-detect" i],
            [id*="anti-adb" i],
            [class*="anti-adb" i],
            #blocker-detected, .blocker-detected,
            #detected-blocker, .detected-blocker,
            .pum-overlay, .popup-overlay-blocker,
            div[style*="z-index: 9999"][style*="position: fixed"][style*="background"]:not(:has(video)):not(:has(iframe)) {
              display: none !important;
              visibility: hidden !important;
              opacity: 0 !important;
              pointer-events: none !important;
            }
            /* Pastikan ad placeholder tetap punya dimensi (≠0) agar detector
               berbasis offsetHeight lolos. ins.adsbygoogle adalah tag standar
               Google Ads yang sering dicek. */
            ins.adsbygoogle, .adsbygoogle, .ads-banner, .ad-container {
              display: inline-block !important;
              min-width: 1px !important;
              min-height: 1px !important;
              opacity: 0 !important;
              pointer-events: none !important;
              position: absolute !important;
              left: -9999px !important;
            }
            /* Hide common ad elements from playmogo/streampoi embeds */
            [class*="ad-"], [id*="ad-"], [class*="banner"], .pop-up, .popup,
            .overlay-ad, [class*="sponsor"], iframe[src*="ad"],
            div[onclick*="window.open"] {
              display: none !important;
              visibility: hidden !important;
              pointer-events: none !important;
            }
          </style>
          <script>
            // Anti-anti-adblock spoof: banyak embed Nekopoi memuat script
            // detection (FuckAdBlock, BlockAdBlock, sgpb, getAds dari
            // host iklan) yang kalau adsbygoogle/google_jobrunner/__atha
            // tidak ada → tampilkan overlay "publisher doesnt allow adblock".
            // Kita BIARKAN tag script ad ada di DOM (src-nya kita ganti
            // about:blank di server), dan di sini kita buatkan globals dummy
            // supaya detection lolos.
            try {
              var __ab = window.adsbygoogle = window.adsbygoogle || [];
              __ab.loaded = true;
              __ab.push = __ab.push || function(){ return 0; };
              window.google_jobrunner = window.google_jobrunner || {};
              window.google_ad_status = 1;
              window.__atha = window.__atha || {};
              window.canRunAds = true;
              window._SmartLogic = window._SmartLogic || { init: function(){}, push: function(){} };
              // FuckAdBlock / BlockAdBlock interface lengkap.
              var __dummyDetect = function(){
                this.check = function(){ return false; };
                this.on = function(){ return this; };
                this.onDetected = function(){ return this; };
                this.onNotDetected = function(cb){ try { cb && cb(); } catch(_){} return this; };
                this.emit = function(){ return this; };
                this.clearEvent = function(){ return this; };
                this.clearEvents = function(){ return this; };
              };
              window.fuckAdBlock = new __dummyDetect();
              window.FuckAdBlock = __dummyDetect;
              window.blockAdBlock = window.fuckAdBlock;
              window.BlockAdBlock = __dummyDetect;
              window.adblockDetector = { isEnabled: function(cb){ try { cb(false); } catch(_){} } };
              window.detectAdblock = function(){ return false; };
              // Beberapa script detector cek apakah window memiliki property
              // tertentu — buat property dummy supaya semua jawaban "ada iklan".
              try { Object.defineProperty(window, '_pop', { value: function(){}, writable: false, configurable: false }); } catch(_){}
            } catch (_e) {}

            // Spoof offsetHeight/offsetWidth untuk ad-elements supaya
            // detector berbasis ukuran ("kalau ad height = 0, berarti
            // adblock") lolos. Kita pakai getter di Element.prototype.
            try {
              var origOH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
              var origOW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
              var matchAd = function(el){
                if (!el || !el.className) return false;
                var c = String(el.className || '').toLowerCase();
                var i = String(el.id || '').toLowerCase();
                return c.indexOf('adsbygoogle') !== -1 || c.indexOf('ads-') !== -1 || c.indexOf('ad-') !== -1
                    || i.indexOf('adsbygoogle') !== -1 || i.indexOf('ads-') !== -1 || i.indexOf('ad-') !== -1;
              };
              Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
                get: function(){
                  var v = origOH && origOH.get ? origOH.get.call(this) : 0;
                  if (v === 0 && matchAd(this)) return 90;
                  return v;
                }
              });
              Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
                get: function(){
                  var v = origOW && origOW.get ? origOW.get.call(this) : 0;
                  if (v === 0 && matchAd(this)) return 728;
                  return v;
                }
              });
            } catch (_e) {}

            // Hapus overlay anti-adblock yang muncul setelah JS jalan.
            // Pakai MutationObserver supaya overlay yang di-insert dynamic
            // tetap ke-handle, plus interval safety.
            (function() {
              var killSelectors = [
                '[id*="adblock" i]', '[class*="adblock" i]',
                '[id*="adb-detect" i]', '[class*="adb-detect" i]',
                '[id*="anti-adb" i]', '[class*="anti-adb" i]',
                '#blocker', '.blocker-overlay',
                '.detected-blocker', '#detected-blocker',
                '.pum-overlay', '.popup-overlay-blocker'
              ];
              function purge() {
                try {
                  killSelectors.forEach(function(sel) {
                    var nodes;
                    try { nodes = document.querySelectorAll(sel); } catch(_){ return; }
                    for (var i = 0; i < nodes.length; i++) {
                      var n = nodes[i];
                      // Jangan hapus elemen yang berisi video/iframe (player asli).
                      if (n.querySelector && (n.querySelector('video') || n.querySelector('iframe'))) continue;
                      var st = n && window.getComputedStyle ? window.getComputedStyle(n) : null;
                      // Hanya buang overlay (fixed/absolute) — biarkan elemen
                      // dalam flow normal yang kebetulan punya nama match.
                      if (!st || st.position === 'fixed' || st.position === 'absolute') {
                        try { n.parentNode && n.parentNode.removeChild(n); } catch(_){}
                      }
                    }
                  });
                  // Pulihkan body scroll yang sering di-disable saat overlay tampil.
                  if (document.body) {
                    document.body.style.overflow = '';
                    document.body.style.position = '';
                    document.documentElement.style.overflow = '';
                  }
                  // Cari div fixed full-screen dengan z-index tinggi yang TIDAK
                  // mengandung video/iframe — kemungkinan besar overlay anti-adblock.
                  var divs = document.querySelectorAll('div[style*="position: fixed"], div[style*="position:fixed"]');
                  for (var i = 0; i < divs.length; i++) {
                    var d = divs[i];
                    if (!d || !d.style) continue;
                    if (d.querySelector && (d.querySelector('video') || d.querySelector('iframe'))) continue;
                    var z = parseInt(window.getComputedStyle(d).zIndex || '0', 10);
                    if (isNaN(z) || z < 1000) continue;
                    var w = d.offsetWidth, h = d.offsetHeight;
                    if (w >= window.innerWidth * 0.7 && h >= window.innerHeight * 0.5) {
                      try { d.parentNode && d.parentNode.removeChild(d); } catch(_){}
                    }
                  }
                } catch (_e) {}
              }
              if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', purge);
              } else {
                purge();
              }
              window.addEventListener('load', purge);
              try {
                var mo = new MutationObserver(function(){ purge(); });
                mo.observe(document.documentElement, { childList: true, subtree: true });
              } catch(_){}
              setInterval(purge, 800);
            })();

            // Overwrite popup windows
            window.open = function() { console.log('[NEKOPOI PROXY] Blocked popunder window'); return null; };
            window.alert = function(msg) { console.log('[NEKOPOI PROXY] Alert blocked: ' + msg); };
            window.confirm = function() { return true; };
            window.prompt = function() { return ''; };

            // Remove onclick handlers that open popups + remove overlay divs
            document.addEventListener('DOMContentLoaded', function() {
              document.querySelectorAll('[onclick*="window.open"]').forEach(function(el) { el.removeAttribute('onclick'); });
              document.querySelectorAll('div[style*="z-index: 999"], div[style*="z-index:999"], div[style*="position: fixed"], div[style*="position:fixed"]').forEach(function(el) {
                if (!el.querySelector('video') && !el.querySelector('iframe')) el.remove();
              });
            });

            // Block dynamic insertion of new scripts to ad-domains via JS.
            // PENTING: kita kembalikan event 'load' dummy supaya detector yang
            // menunggu onload tidak men-trigger fallback "adblock detected".
            const __nekopoiBlocked = ['googlesyndication','doubleclick','googleadservices','adservice','popads','popunder','adnxs','adsrv','adsterra','exoclick','juicyads','trafficjunky','propellerads','hilltopads','clickadu','richpush','pushnami','mgid.com','taboola','outbrain','revcontent','bontrilou','histats.com','coinhive','crypto-loot','tsartech','syndication','betterads','landingtrack','a-ads','monetag','pushground','pushwoosh','onclickmax','acint.net','adskeeper'];
            const originalCreateElement = document.createElement;
            document.createElement = function(tagName) {
              const element = originalCreateElement.call(document, tagName);
              if (String(tagName).toLowerCase() === 'script') {
                const fakeLoad = function(){
                  try { setTimeout(function(){ element.dispatchEvent(new Event('load')); }, 0); } catch(_){}
                };
                const originalSetAttribute = element.setAttribute;
                element.setAttribute = function(name, value) {
                  if (String(name).toLowerCase() === 'src') {
                    const v = String(value).toLowerCase();
                    if (__nekopoiBlocked.some(function(d){ return v.indexOf(d) !== -1; })) {
                      fakeLoad();
                      return originalSetAttribute.call(element, 'src', 'about:blank');
                    }
                  }
                  originalSetAttribute.call(element, name, value);
                };
                Object.defineProperty(element, 'src', {
                  set: function(value) {
                    const v = String(value).toLowerCase();
                    if (__nekopoiBlocked.some(function(d){ return v.indexOf(d) !== -1; })) {
                      fakeLoad();
                      element.setAttribute('src', 'about:blank');
                      return;
                    }
                    element.setAttribute('src', value);
                  },
                  get: function() { return element.getAttribute('src'); }
                });
              }
              return element;
            };

            // Intercept Node.prototype.appendChild to block ad scripts that
            // bypass document.createElement interception (e.g. cloned nodes).
            const __origAppendChild = Node.prototype.appendChild;
            Node.prototype.appendChild = function(child) {
              if (child && child.tagName === 'SCRIPT' && child.src) {
                const src = child.src.toLowerCase();
                if (__nekopoiBlocked.some(function(d){ return src.indexOf(d) !== -1; })) {
                  console.log('[NEKOPOI PROXY] Blocked appendChild script: ' + child.src);
                  return child;
                }
              }
              return __origAppendChild.call(this, child);
            };

            // Force player elements to fill the viewport even if upstream JS
            // sets pixel dimensions (e.g., width="320" via JW Player config).
            (function() {
              function forceFit() {
                try {
                  var sel = 'video, iframe, .jw-video, .jwplayer, .jw-wrapper, .jw-media, .video-js, .vjs-tech, .plyr__video-wrapper, .player-wrapper, .video-container, #player, #player-container';
                  var nodes = document.querySelectorAll(sel);
                  for (var i = 0; i < nodes.length; i++) {
                    var el = nodes[i];
                    el.removeAttribute && el.removeAttribute('width');
                    el.removeAttribute && el.removeAttribute('height');
                    if (el.style) {
                      el.style.setProperty('width', '100%', 'important');
                      el.style.setProperty('height', '100%', 'important');
                      el.style.setProperty('max-width', 'none', 'important');
                      el.style.setProperty('max-height', 'none', 'important');
                    }
                  }
                } catch (err) {}
              }
              if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', forceFit);
              } else {
                forceFit();
              }
              window.addEventListener('load', forceFit);
              setInterval(forceFit, 750);
            })();
          </script>
        `
        );
      }

      res.setHeader("Content-Type", "text/html");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).send(root.toString());
    } catch (e) {
      console.error("[NEKOPOI IFRAME PROXY ERROR]", e);
      return res.status(500).send("Iframe proxy error");
    }
  }
};

export default nekopoiController;
