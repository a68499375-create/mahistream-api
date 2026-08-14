import type { Request, Response } from "express";
import { db, queryDb, runDb } from "../db/database.js";
import setPayload from "../helpers/setPayload.js";

// In-memory subscriber registry untuk SSE — key = anime_id (atau anime_id|episode).
// Setiap socket terdaftar di sini supaya saat ada comment baru kita push ke
// semua subscriber pada anime/episode yang sama secara realtime.
const sseSubscribers = new Map<string, Set<Response>>();

const subscribeKey = (animeId: string, episode?: string | null) =>
  episode ? `${animeId}|${episode}` : animeId;

const broadcast = (animeId: string, episode: string | null | undefined, event: any) => {
  const targets: Response[] = [];
  const keys = [subscribeKey(animeId), subscribeKey(animeId, episode || undefined)];
  keys.forEach((k) => {
    const set = sseSubscribers.get(k);
    if (set) set.forEach((res) => targets.push(res));
  });
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  targets.forEach((res) => {
    try { res.write(payload); } catch (_e) { /* socket closed */ }
  });
};

const commentsController = {
  // GET /comments?animeId=...&episode=...&page=1&limit=20
  async list(req: Request, res: Response) {
    const animeId = String(req.query.animeId || "");
    const episode = req.query.episode ? String(req.query.episode) : null;
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20));
    const offset = (page - 1) * limit;

    if (!animeId) {
      return res.status(400).json(setPayload(res, { message: "animeId is required" }));
    }
    try {
      // Ambil top-level comments dulu, lalu replies-nya.
      const where = episode ? "anime_id = ? AND (episode = ? OR episode IS NULL)" : "anime_id = ?";
      const params: any[] = episode ? [animeId, episode] : [animeId];
      const tops = await queryDb(
        `SELECT c.*, u.display_name as user_name, u.picture as user_picture
         FROM comments c
         LEFT JOIN users u ON u.id = c.user_id
         WHERE ${where} AND c.parent_id IS NULL
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      // Untuk simplicity, ambil semua replies dalam 1 query lalu group.
      const topIds = tops.map((t: any) => t.id);
      let replies: any[] = [];
      if (topIds.length) {
        const placeholders = topIds.map(() => "?").join(",");
        replies = await queryDb(
          `SELECT c.*, u.display_name as user_name, u.picture as user_picture
           FROM comments c
           LEFT JOIN users u ON u.id = c.user_id
           WHERE c.parent_id IN (${placeholders})
           ORDER BY c.created_at ASC`,
          topIds
        );
      }
      const byParent = new Map<number, any[]>();
      replies.forEach((r) => {
        if (!byParent.has(r.parent_id)) byParent.set(r.parent_id, []);
        byParent.get(r.parent_id)!.push(r);
      });
      const out = tops.map((t: any) => ({ ...t, replies: byParent.get(t.id) || [] }));
      return res.status(200).json(setPayload(res, { data: { comments: out, page, limit } }));
    } catch (e: any) {
      console.error("[comments] list error", e?.message);
      return res.status(500).json(setPayload(res, { message: "Failed to list comments" }));
    }
  },

  // POST /comments  { userId, animeId, episode?, parentId?, body }
  async create(req: Request, res: Response) {
    const { userId, animeId, episode, parentId, body } = req.body || {};
    if (!userId || !animeId || !body) {
      return res.status(400).json(setPayload(res, { message: "userId, animeId, body required" }));
    }
    const cleanBody = String(body).trim().slice(0, 2000);
    if (!cleanBody) {
      return res.status(400).json(setPayload(res, { message: "Comment body cannot be empty" }));
    }
    try {
      // Auto-create user kalau belum ada (mirror pattern user.controller).
      await runDb(
        `INSERT OR IGNORE INTO users (id, email, display_name) VALUES (?, ?, ?)`,
        [userId, userId, userId.split?.("@")?.[0] || userId]
      );
      const result = await runDb(
        `INSERT INTO comments (user_id, anime_id, episode, parent_id, body) VALUES (?, ?, ?, ?, ?)`,
        [userId, animeId, episode || null, parentId || null, cleanBody]
      );
      const newId = (result as any).lastID;
      const row = (await queryDb(
        `SELECT c.*, u.display_name as user_name, u.picture as user_picture
         FROM comments c LEFT JOIN users u ON u.id = c.user_id
         WHERE c.id = ?`,
        [newId]
      ))[0];

      // Gamifikasi: +3 pts untuk comment baru.
      await runDb(
        `INSERT INTO user_points (user_id, points) VALUES (?, 3)
         ON CONFLICT(user_id) DO UPDATE SET points = points + 3, updated_at = CURRENT_TIMESTAMP`,
        [userId]
      );
      await runDb(`INSERT INTO points_log (user_id, action, delta, meta) VALUES (?, 'comment', 3, ?)`,
        [userId, JSON.stringify({ animeId, commentId: newId })]
      );

      // SSE broadcast ke subscriber anime/episode terkait.
      broadcast(animeId, episode || null, { type: "new", comment: row });

      return res.status(200).json(setPayload(res, { data: { comment: row } }));
    } catch (e: any) {
      console.error("[comments] create error", e?.message);
      return res.status(500).json(setPayload(res, { message: "Failed to create comment" }));
    }
  },

  // POST /comments/:id/like  { userId }
  async like(req: Request, res: Response) {
    const id = parseInt(req.params.id || "0", 10);
    const userId = String(req.body?.userId || req.query.userId || "");
    if (!id || !userId) {
      return res.status(400).json(setPayload(res, { message: "id + userId required" }));
    }
    try {
      // Toggle like — kalau sudah ada, hapus; kalau belum, tambah.
      const existing = await queryDb(
        `SELECT id FROM comment_likes WHERE user_id = ? AND comment_id = ?`,
        [userId, id]
      );
      if (existing.length > 0) {
        await runDb(`DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?`, [userId, id]);
        await runDb(`UPDATE comments SET likes = MAX(0, likes - 1) WHERE id = ?`, [id]);
      } else {
        await runDb(`INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)`, [userId, id]);
        await runDb(`UPDATE comments SET likes = likes + 1 WHERE id = ?`, [id]);
      }
      const row = (await queryDb(`SELECT * FROM comments WHERE id = ?`, [id]))[0];
      const liked = existing.length === 0;
      // Broadcast updated likes count.
      if (row) broadcast(row.anime_id, row.episode, { type: "like", commentId: id, likes: row.likes });
      return res.status(200).json(setPayload(res, { data: { liked, likes: row?.likes || 0 } }));
    } catch (e: any) {
      console.error("[comments] like error", e?.message);
      return res.status(500).json(setPayload(res, { message: "Failed to toggle like" }));
    }
  },

  // DELETE /comments/:id?userId=...
  async remove(req: Request, res: Response) {
    const id = parseInt(req.params.id || "0", 10);
    const userId = String(req.query.userId || "");
    if (!id || !userId) {
      return res.status(400).json(setPayload(res, { message: "id + userId required" }));
    }
    try {
      const own = await queryDb(`SELECT user_id, anime_id, episode FROM comments WHERE id = ?`, [id]);
      if (own.length === 0) return res.status(404).json(setPayload(res, { message: "Not found" }));
      if (own[0].user_id !== userId) return res.status(403).json(setPayload(res, { message: "Forbidden" }));
      await runDb(`DELETE FROM comments WHERE id = ? OR parent_id = ?`, [id, id]);
      broadcast(own[0].anime_id, own[0].episode, { type: "delete", commentId: id });
      return res.status(200).json(setPayload(res, { data: { deleted: true } }));
    } catch (e: any) {
      return res.status(500).json(setPayload(res, { message: "Failed to delete" }));
    }
  },

  // GET /comments/sse/stream?animeId=...&episode=...
  // Browser pakai EventSource — backend keep connection open + push event.
  sseStream(req: Request, res: Response) {
    const animeId = String(req.query.animeId || "");
    const episode = req.query.episode ? String(req.query.episode) : null;
    if (!animeId) {
      res.status(400).end("animeId required");
      return;
    }
    const key = subscribeKey(animeId, episode || undefined);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    res.write(`: connected ${new Date().toISOString()}\n\n`);

    if (!sseSubscribers.has(key)) sseSubscribers.set(key, new Set());
    sseSubscribers.get(key)!.add(res);

    // Keep-alive ping setiap 25 detik supaya proxy tidak tutup koneksi.
    const ping = setInterval(() => {
      try { res.write(`: ping ${Date.now()}\n\n`); } catch (_e) {}
    }, 25_000);

    req.on("close", () => {
      clearInterval(ping);
      sseSubscribers.get(key)?.delete(res);
    });
  },
};

export default commentsController;
