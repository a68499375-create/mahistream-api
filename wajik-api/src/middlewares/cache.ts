import type { Request, Response, NextFunction } from "express";
import { LRUCache } from "lru-cache";
import path from "path";

const defaultTTL = 1000 * 60 * 60 * 12;
const lruCache = new LRUCache({
  max: 500,
  allowStale: true,  // serve stale data sambil revalidate di background
  updateAgeOnGet: true,
  updateAgeOnHas: false,
  ttl: defaultTTL,
});

/**
 * @param ttl minutes, default = 720
 */
export function serverCache(ttl?: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const newTTL = ttl ? 1000 * 60 * ttl : defaultTTL;
    const key = path.join(req.originalUrl, "/").replace(/\\/g, "/");
    const cachedData = lruCache.get(key);

    if (cachedData) {
      // console.log("hit");

      res.json(cachedData);

      return;
    }

    // console.log("miss");

    const originalJson = res.json.bind(res);

    res.json = (body: IPayload) => {
      if (res.statusCode < 399) {
        // Jangan cache hasil kosong — scraper mungkin gagal sementara
        // (FlareSolverr timeout, session dingin, dll). Kalau di-cache,
        // user dapat empty selama TTL meski retry berikutnya bisa berhasil.
        const data = (body as any)?.data;
        const isEmpty = !data ||
          (Array.isArray(data) && data.length === 0) ||
          (data.animeList && Array.isArray(data.animeList) && data.animeList.length === 0) ||
          (data.scheduleList && Array.isArray(data.scheduleList) && data.scheduleList.every(
            (s: any) => !s.animeList || s.animeList.length === 0
          ));
        if (!isEmpty) {
          lruCache.set(key, body, { ttl: newTTL });
        }
      }

      return originalJson(body);
    };

    next();
  };
}

/**
 * @param maxAge minutes, default = 5
 */
export function clientCache(maxAge?: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", `public, max-age=${maxAge ? maxAge * 60 : 300}`);

    next();
  };
}
