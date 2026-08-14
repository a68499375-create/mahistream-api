import type { Request, Response } from "express";
import { queryDb, runDb } from "../db/database.js";
import setPayload from "../helpers/setPayload.js";

const recommendationsController = {
  // POST /recommendations/view  { animeId, title, poster, source, genres? }
  // Dipanggil saat user buka halaman detail anime. Increment view_count
  // dipakai untuk popularity ranking.
  async track(req: Request, res: Response) {
    const { animeId, title, poster, source, genres } = req.body || {};
    if (!animeId) {
      return res.status(400).json(setPayload(res, { message: "animeId required" }));
    }
    try {
      const genreStr = Array.isArray(genres) ? genres.join(",") : (typeof genres === "string" ? genres : "");
      await runDb(
        `INSERT INTO anime_stats (anime_id, title, poster_url, source, genres, view_count, last_viewed)
         VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(anime_id) DO UPDATE SET
           view_count = view_count + 1,
           last_viewed = CURRENT_TIMESTAMP,
           title = COALESCE(NULLIF(excluded.title, ''), title),
           poster_url = COALESCE(NULLIF(excluded.poster_url, ''), poster_url),
           source = COALESCE(NULLIF(excluded.source, ''), source),
           genres = COALESCE(NULLIF(excluded.genres, ''), genres)`,
        [animeId, title || "", poster || "", source || "kuramanime", genreStr]
      );
      return res.status(200).json(setPayload(res, { data: { tracked: true } }));
    } catch (e: any) {
      return res.status(500).json(setPayload(res, { message: "Failed to track view" }));
    }
  },

  // GET /recommendations/popular?limit=20
  // Top anime by view_count dalam window 30 hari terakhir. Recency-bias.
  async popular(req: Request, res: Response) {
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20));
    try {
      const rows = await queryDb(
        `SELECT anime_id, title, poster_url, source, genres, view_count
         FROM anime_stats
         WHERE last_viewed > datetime('now', '-30 days')
         ORDER BY view_count DESC
         LIMIT ?`,
        [limit]
      );
      return res.status(200).json(setPayload(res, { data: { items: rows } }));
    } catch (e: any) {
      return res.status(500).json(setPayload(res, { message: "Failed" }));
    }
  },

  // GET /recommendations/similar?animeId=...&limit=10
  // Cari anime lain yang share minimal 1 genre dengan anime ini.
  async similar(req: Request, res: Response) {
    const animeId = String(req.query.animeId || "");
    const limit = Math.min(30, Math.max(1, parseInt(String(req.query.limit || "12"), 10) || 12));
    if (!animeId) {
      return res.status(400).json(setPayload(res, { message: "animeId required" }));
    }
    try {
      const seed = (await queryDb(
        `SELECT genres, source FROM anime_stats WHERE anime_id = ?`,
        [animeId]
      ))[0];
      if (!seed || !seed.genres) {
        // Fallback: kalau seed tidak ada genre, kembalikan popular.
        const rows = await queryDb(
          `SELECT anime_id, title, poster_url, source, view_count
           FROM anime_stats WHERE anime_id != ?
           ORDER BY view_count DESC LIMIT ?`,
          [animeId, limit]
        );
        return res.status(200).json(setPayload(res, { data: { items: rows } }));
      }
      const seedGenres = String(seed.genres).split(",").map((s) => s.trim()).filter(Boolean);
      // Hitung overlap genre via LIKE chain.
      const conditions = seedGenres.map(() => `genres LIKE ?`).join(" OR ");
      const params = seedGenres.map((g) => `%${g}%`);
      const rows = await queryDb(
        `SELECT anime_id, title, poster_url, source, genres, view_count
         FROM anime_stats
         WHERE anime_id != ? AND (${conditions})
         ORDER BY view_count DESC
         LIMIT ?`,
        [animeId, ...params, limit]
      );
      return res.status(200).json(setPayload(res, { data: { items: rows } }));
    } catch (e: any) {
      return res.status(500).json(setPayload(res, { message: "Failed" }));
    }
  },

  // GET /recommendations/for-you?userId=...&limit=12
  // Berbasis history user — ambil anime mereka tonton terakhir, cari yang
  // share genre, kecualikan yang sudah ditonton.
  async forYou(req: Request, res: Response) {
    const userId = String(req.query.userId || "");
    const limit = Math.min(30, Math.max(1, parseInt(String(req.query.limit || "12"), 10) || 12));
    if (!userId) {
      return res.status(400).json(setPayload(res, { message: "userId required" }));
    }
    try {
      const history = await queryDb(
        `SELECT DISTINCT anime_id FROM history WHERE user_id = ? ORDER BY watched_at DESC LIMIT 5`,
        [userId]
      );
      const watchedIds = history.map((h: any) => h.anime_id);
      if (watchedIds.length === 0) {
        // Kalau belum ada history, fallback ke popular.
        const rows = await queryDb(
          `SELECT anime_id, title, poster_url, source, view_count
           FROM anime_stats ORDER BY view_count DESC LIMIT ?`,
          [limit]
        );
        return res.status(200).json(setPayload(res, { data: { items: rows, basis: "popular" } }));
      }
      // Ambil semua genre dari anime yang sudah ditonton.
      const placeholders = watchedIds.map(() => "?").join(",");
      const seeds = await queryDb(
        `SELECT genres FROM anime_stats WHERE anime_id IN (${placeholders})`,
        watchedIds
      );
      const genreSet = new Set<string>();
      seeds.forEach((s: any) => {
        String(s.genres || "").split(",").forEach((g: string) => { const t = g.trim(); if (t) genreSet.add(t); });
      });
      if (genreSet.size === 0) {
        const rows = await queryDb(
          `SELECT anime_id, title, poster_url, source, view_count
           FROM anime_stats ORDER BY view_count DESC LIMIT ?`,
          [limit]
        );
        return res.status(200).json(setPayload(res, { data: { items: rows, basis: "popular" } }));
      }
      const genres = Array.from(genreSet);
      const cond = genres.map(() => "genres LIKE ?").join(" OR ");
      const params = genres.map((g) => `%${g}%`);
      const watchPh = watchedIds.map(() => "?").join(",");
      const rows = await queryDb(
        `SELECT anime_id, title, poster_url, source, genres, view_count
         FROM anime_stats
         WHERE anime_id NOT IN (${watchPh}) AND (${cond})
         ORDER BY view_count DESC
         LIMIT ?`,
        [...watchedIds, ...params, limit]
      );
      return res.status(200).json(setPayload(res, { data: { items: rows, basis: "history" } }));
    } catch (e: any) {
      return res.status(500).json(setPayload(res, { message: "Failed" }));
    }
  },
};

export default recommendationsController;
