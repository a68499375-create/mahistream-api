import type { Request, Response } from "express";
import { Agent } from "undici";
import { validateProxyUrl } from "../helpers/validateUrl.js";

// ISP blocks DNS for these hosts; map them to Cloudflare edge IP (same trick as getHTML).
const DNS_OVERRIDES: Record<string, string> = {
  "nekopoi.care": "104.21.84.148",
};

const lookupOverride = (hostname: string, opts: any, cb: any) => {
  const ip = DNS_OVERRIDES[hostname];
  if (ip) {
    // undici may call with { all: true } and then expects an array result.
    if (opts && opts.all) return cb(null, [{ address: ip, family: 4 }]);
    return cb(null, ip, 4);
  }
  // Fall back to system DNS for everything else.
  import("dns").then(({ lookup }) => lookup(hostname, opts, cb));
};

const bypassAgent = new Agent({ connect: { lookup: lookupOverride as any } });

// Headers paling mendekati Chrome desktop modern — beberapa CDN
// (kdrive.my.id, asuna.my.id, iino.my.id) menolak request yang tidak
// mengirim sec-fetch / sec-ch-ua dengan HTTP 451. Kirim full set supaya
// origin tidak mengira request datang dari bot/scraper.
const REAL_BROWSER_HEADERS: Record<string, string> = {
  "Accept": "video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "Sec-Ch-Ua": '"Google Chrome";v="120", "Chromium";v="120", "Not-A.Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "video",
  "Sec-Fetch-Mode": "no-cors",
  "Sec-Fetch-Site": "cross-site",
};

// Per-host referer fallback chain. Beberapa CDN strict pada referer asal:
//   - Nekopoi CDN butuh referer nekopoi.care, kalau dipakai Kurama → 403
//   - Kurama CDN sebaliknya
//   - Pixeldrain region-block dari Indonesia → semua referer 451 (skip di FE)
// Helper memilih daftar referer kandidat berdasarkan URL target + referer
// yang dikirim client.
const pickRefererCandidates = (targetUrl: string, primary?: string): string[] => {
  const low = targetUrl.toLowerCase();
  const isNekopoi = low.includes('nekopoi') || low.includes('desustream') ||
    low.includes('odstream') || low.includes('ondesu') || low.includes('streamruby') ||
    low.includes('streampoi') || low.includes('vidnest');
  const isKurama = low.includes('kdrive') || low.includes('iino.my.id') ||
    low.includes('komari.my.id') || low.includes('asuna.my.id') ||
    low.includes('kitasan.my.id') || low.includes('chisato.my.id') ||
    low.includes('huntersekai') || low.includes('r2.nyomo');

  const set = new Set<string>();
  if (primary) set.add(primary);
  if (isNekopoi) {
    set.add("https://nekopoi.care/");
    set.add("https://desustream.com/");
    set.add(""); // no referer
  } else if (isKurama) {
    set.add("https://v18.kuramanime.ing/");
    set.add("https://kuramanime.dad/");
    set.add(""); // no referer
  } else {
    // Generic: tetap coba kedua referer populer + no-referer
    set.add("https://v18.kuramanime.ing/");
    set.add("https://nekopoi.care/");
    set.add(""); // no referer
  }
  return Array.from(set);
};

const proxyController = {
  async streamProxy(req: Request, res: Response) {
    try {
      const targetUrl = req.query.url as string;
      const refererQ = req.query.referer as string || "";
      if (!targetUrl) return res.status(400).send("Missing URL");

      const { valid, reason } = validateProxyUrl(targetUrl);
      if (!valid) return res.status(400).json({ error: reason });

      const baseHeaders: Record<string, string> = {
        "User-Agent": (req.headers["user-agent"] as string) || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ...REAL_BROWSER_HEADERS,
      };

      if (req.headers.range) baseHeaders["Range"] = req.headers.range;

      const abortController = new AbortController();
      req.on('close', () => {
        try { abortController.abort(); } catch (e) { }
      });

      // Use the DNS-bypass dispatcher for hosts the ISP blocks.
      let useBypass = false;
      try { useBypass = !!DNS_OVERRIDES[new URL(targetUrl).hostname]; } catch (e) { }

      // Try several referer strategies in order. Beberapa CDN balas 451
      // dengan referer Kuramanime → coba no-referer. Yang lain butuh
      // referer Kuramanime → coba dengan itu dulu.
      let response: globalThis.Response | null = null;
      let lastStatus = 0;
      const tried: { ref: string; status: number }[] = [];
      for (const ref of pickRefererCandidates(targetUrl, refererQ)) {
        const headers = { ...baseHeaders };
        if (ref) headers["Referer"] = ref;
        // For absent referer, also strip Origin (some CDNs auto-fail
        // when Origin doesn't match Referer).
        try {
          const r = await fetch(targetUrl, {
            headers,
            signal: abortController.signal as any,
            redirect: "follow",
            ...(useBypass ? { dispatcher: bypassAgent } : {}),
          } as any);
          tried.push({ ref: ref || "<none>", status: r.status });
          lastStatus = r.status;
          // 451 / 403 / 429 → coba referer berikutnya
          if (r.status === 451 || r.status === 403 || r.status === 429) {
            // konsumsi body kecil agar koneksi dilepas
            try { await r.arrayBuffer(); } catch { }
            continue;
          }
          response = r;
          break;
        } catch (e: any) {
          tried.push({ ref: ref || "<none>", status: 0 });
          continue;
        }
      }

      if (!response) {
        const msg = `Origin tolak (terakhir ${lastStatus || "no-response"}). Coba mirror lain.`;
        console.warn("[PROXY] all referer attempts failed", JSON.stringify(tried), "url=", targetUrl);
        if (!res.headersSent) res.status(lastStatus || 502).send(msg);
        return;
      }

      res.status(response.status);

      // Forward headers DENGAN HATI-HATI. Node fetch (undici) otomatis
      // mendecode gzip/br body, tapi response.headers MASIH mengandung
      // Content-Encoding: gzip dari origin. Kalau kita forward header ini
      // ke client, browser akan coba decode ulang body yang SUDAH decoded
      // → file biner (.mp4 / .m3u8) rusak parah, ukuran tetap penuh tapi
      // tidak bisa diputar. Ini akar masalah "video di galeri ngak mau
      // berputar".
      //
      // Content-Length kita strip HANYA kalau origin mengirim
      // Content-Encoding (length tidak match body decoded). Kalau response
      // mentah (mayoritas CDN video tidak compressed) → forward apa
      // adanya supaya progress bar download akurat. Tanpa Content-Length,
      // downloader Kurama nyantol di 95% karena tidak tahu kapan EOF.
      const originalEncoding = (response.headers.get('content-encoding') || '').toLowerCase();
      const hasEncoding = !!originalEncoding && originalEncoding !== 'identity';
      const STRIPPED = new Set([
        'content-encoding',
        'transfer-encoding',
        'connection',
        'content-disposition',
        'access-control-allow-origin',
        'x-frame-options',
      ]);
      if (hasEncoding) STRIPPED.add('content-length');
      response.headers.forEach((value, key) => {
        if (!STRIPPED.has(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      });

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

      // HLS manifest (.m3u8): the playlist lists segment/key/sub-playlist URLs that
      // normally point straight at the CDN. The browser would fetch those directly
      // WITHOUT the referer the CDN requires -> 403 -> "stream loads but video won't
      // play" (the Rewind 2025 symptom). So we rewrite every URL line to route back
      // through THIS proxy, carrying the same referer.
      const ct = (response.headers.get('content-type') || '').toLowerCase();
      const isManifest = targetUrl.includes('.m3u8') || ct.includes('mpegurl') || ct.includes('vnd.apple');
      if (isManifest && response.body) {
        const text = await response.text();
        const proxyBase = `${req.protocol}://${req.get('host')}${req.baseUrl || ''}${req.path}`;
        const wrap = (abs: string) =>
          `${proxyBase}?url=${encodeURIComponent(abs)}${refererQ ? `&referer=${encodeURIComponent(refererQ)}` : ''}`;

        const rewritten = text.split('\n').map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          // Rewrite URI="..." attributes (EXT-X-KEY, EXT-X-MEDIA, etc.)
          if (trimmed.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
              try { return `URI="${wrap(new URL(uri, targetUrl).href)}"`; }
              catch { return _m; }
            });
          }
          // Otherwise it's a segment / sub-playlist URL line.
          try { return wrap(new URL(trimmed, targetUrl).href); }
          catch { return line; }
        }).join('\n');

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.removeHeader('Content-Length');
        return res.send(rewritten);
      }

      if (response.body) {
        const { Readable } = await import('stream');
        // @ts-ignore
        const nodeStream = Readable.fromWeb(response.body);
        nodeStream.pipe(res);
        // Ensure the readable stream is destroyed if client disconnects
        // after piping has started (abort signal may not propagate cleanly).
        req.on('close', () => {
          if (!nodeStream.destroyed) nodeStream.destroy();
        });
      } else {
        res.end();
      }
    } catch (e: any) {
      console.error("[IMG/STREAM PROXY ERROR]", e?.message, e?.cause?.message || "");
      if (!res.headersSent) {
        res.status(500).send("Proxy error");
      }
    }
  }
};

export default proxyController;
