import type { Request, Response } from "express";
import { queryDb, runDb } from "../db/database.js";
import setPayload from "../helpers/setPayload.js";

// Hitung tanggal hari ini dalam timezone Asia/Jakarta (WIB), format YYYY-MM-DD.
// Streak dihitung per hari WIB supaya konsisten dengan user di Indonesia.
const todayWIB = (): string => {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date());
};

const dayDiff = (a: string, b: string): number => {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((da - db) / (1000 * 60 * 60 * 24));
};

const profileController = {
  // POST /profile/signin  { userId }
  // Sekali per hari per user. Streak naik kalau hari ini adalah hari setelah
  // last_signin_date. Reset kalau ada hari yang di-skip.
  async signin(req: Request, res: Response) {
    const userId = String(req.body?.userId || req.query.userId || "");
    if (!userId) return res.status(400).json(setPayload(res, { message: "userId required" }));
    const today = todayWIB();
    try {
      const row = (await queryDb(`SELECT * FROM signin_streak WHERE user_id = ?`, [userId]))[0];
      let newStreak = 1;
      let longest = 1;
      let totalSignins = 1;
      let alreadySignedToday = false;
      if (row) {
        if (row.last_signin_date === today) {
          alreadySignedToday = true;
          newStreak = row.current_streak;
          longest = row.longest_streak;
          totalSignins = row.total_signins;
        } else {
          const diff = row.last_signin_date ? dayDiff(today, row.last_signin_date) : 999;
          newStreak = diff === 1 ? (row.current_streak + 1) : 1;
          longest = Math.max(row.longest_streak || 0, newStreak);
          totalSignins = (row.total_signins || 0) + 1;
          await runDb(
            `UPDATE signin_streak SET last_signin_date = ?, current_streak = ?, longest_streak = ?, total_signins = ? WHERE user_id = ?`,
            [today, newStreak, longest, totalSignins, userId]
          );
        }
      } else {
        await runDb(
          `INSERT INTO signin_streak (user_id, last_signin_date, current_streak, longest_streak, total_signins) VALUES (?, ?, 1, 1, 1)`,
          [userId, today]
        );
      }

      let pointsGained = 0;
      if (!alreadySignedToday) {
        pointsGained = 10;
        if (newStreak > 0 && newStreak % 7 === 0) pointsGained += 5;
        await runDb(
          `INSERT OR IGNORE INTO users (id, email, display_name) VALUES (?, ?, ?)`,
          [userId, userId, userId.split?.("@")?.[0] || userId]
        );
        await runDb(
          `INSERT INTO user_points (user_id, points) VALUES (?, ?)
           ON CONFLICT(user_id) DO UPDATE SET points = points + ?, updated_at = CURRENT_TIMESTAMP`,
          [userId, pointsGained, pointsGained]
        );
        await runDb(`INSERT INTO points_log (user_id, action, delta, meta) VALUES (?, 'signin', ?, ?)`,
          [userId, pointsGained, JSON.stringify({ streak: newStreak })]);
      }
      return res.status(200).json(setPayload(res, {
        data: { currentStreak: newStreak, longestStreak: longest, totalSignins, pointsGained, alreadySignedToday }
      }));
    } catch (e: any) {
      console.error("[profile] signin error", e?.message);
      return res.status(500).json(setPayload(res, { message: "Failed" }));
    }
  },

  async streak(req: Request, res: Response) {
    const userId = String(req.query.userId || "");
    if (!userId) return res.status(400).json(setPayload(res, { message: "userId required" }));
    try {
      const row = (await queryDb(`SELECT * FROM signin_streak WHERE user_id = ?`, [userId]))[0] || {};
      return res.status(200).json(setPayload(res, {
        data: { currentStreak: row.current_streak || 0, longestStreak: row.longest_streak || 0, totalSignins: row.total_signins || 0 }
      }));
    } catch { return res.status(500).json(setPayload(res, { message: "Failed" })); }
  },

  async points(req: Request, res: Response) {
    const userId = String(req.query.userId || "");
    if (!userId) return res.status(400).json(setPayload(res, { message: "userId required" }));
    try {
      const row = (await queryDb(`SELECT points FROM user_points WHERE user_id = ?`, [userId]))[0];
      const log = await queryDb(
        `SELECT action, delta, meta, created_at FROM points_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
        [userId]
      );
      return res.status(200).json(setPayload(res, { data: { points: row?.points || 0, log } }));
    } catch { return res.status(500).json(setPayload(res, { message: "Failed" })); }
  },

  async leaderboard(req: Request, res: Response) {
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20));
    try {
      const rows = await queryDb(
        `SELECT u.id as user_id, u.display_name, u.picture, p.points, s.current_streak
         FROM user_points p
         LEFT JOIN users u ON u.id = p.user_id
         LEFT JOIN signin_streak s ON s.user_id = p.user_id
         WHERE p.points > 0
         ORDER BY p.points DESC, s.current_streak DESC
         LIMIT ?`,
        [limit]
      );
      return res.status(200).json(setPayload(res, { data: { items: rows } }));
    } catch { return res.status(500).json(setPayload(res, { message: "Failed" })); }
  },

  async me(req: Request, res: Response) {
    const userId = String(req.query.userId || "");
    if (!userId) return res.status(400).json(setPayload(res, { message: "userId required" }));
    try {
      const user = (await queryDb(`SELECT * FROM users WHERE id = ?`, [userId]))[0] || { id: userId };
      const streak = (await queryDb(`SELECT * FROM signin_streak WHERE user_id = ?`, [userId]))[0] || {};
      const points = (await queryDb(`SELECT points FROM user_points WHERE user_id = ?`, [userId]))[0] || { points: 0 };
      const counts = {
        history: ((await queryDb(`SELECT COUNT(*) as c FROM history WHERE user_id = ?`, [userId]))[0] as any)?.c || 0,
        bookmark: ((await queryDb(`SELECT COUNT(*) as c FROM bookmarks WHERE user_id = ?`, [userId]))[0] as any)?.c || 0,
        comments: ((await queryDb(`SELECT COUNT(*) as c FROM comments WHERE user_id = ?`, [userId]))[0] as any)?.c || 0,
      };
      return res.status(200).json(setPayload(res, {
        data: {
          user,
          streak: { currentStreak: streak.current_streak || 0, longestStreak: streak.longest_streak || 0, totalSignins: streak.total_signins || 0 },
          points: points.points || 0,
          counts,
        }
      }));
    } catch { return res.status(500).json(setPayload(res, { message: "Failed" })); }
  },

  // POST /profile/update  { userId, name?, bio?, picture?, background_url? }
  // Termasuk edit banner — mirip nanimeid.
  async update(req: Request, res: Response) {
    const { userId, name, bio, picture, background_url } = req.body || {};
    if (!userId) return res.status(400).json(setPayload(res, { message: "userId required" }));
    try {
      await runDb(
        `INSERT OR IGNORE INTO users (id, email, display_name) VALUES (?, ?, ?)`,
        [userId, userId, name || userId.split?.("@")?.[0] || userId]
      );
      const updates: string[] = [];
      const params: any[] = [];
      if (name !== undefined) { updates.push("display_name = ?"); params.push(String(name).slice(0, 64)); }
      if (bio !== undefined) { updates.push("bio = ?"); params.push(String(bio).slice(0, 280)); }
      if (picture !== undefined) { updates.push("picture = ?"); params.push(String(picture)); }
      if (background_url !== undefined) { updates.push("background_url = ?"); params.push(String(background_url)); }
      if (updates.length > 0) {
        params.push(userId);
        await runDb(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);
      }
      const user = (await queryDb(`SELECT * FROM users WHERE id = ?`, [userId]))[0];
      return res.status(200).json(setPayload(res, { data: { user } }));
    } catch { return res.status(500).json(setPayload(res, { message: "Failed" })); }
  },

  async public(req: Request, res: Response) {
    const userId = String(req.params.userId || "");
    if (!userId) return res.status(400).json(setPayload(res, { message: "userId required" }));
    try {
      const user = (await queryDb(
        `SELECT id, username, display_name, picture, background_url, bio FROM users WHERE id = ?`,
        [userId]
      ))[0];
      if (!user) return res.status(404).json(setPayload(res, { message: "Not found" }));
      const streak = (await queryDb(`SELECT current_streak, longest_streak FROM signin_streak WHERE user_id = ?`, [userId]))[0] || {};
      const points = (await queryDb(`SELECT points FROM user_points WHERE user_id = ?`, [userId]))[0] || { points: 0 };
      const recentWatched = await queryDb(
        `SELECT anime_id, title, poster_url, episode, watched_at FROM history WHERE user_id = ? ORDER BY watched_at DESC LIMIT 12`,
        [userId]
      );
      return res.status(200).json(setPayload(res, { data: { user, streak, points: points.points || 0, recentWatched } }));
    } catch { return res.status(500).json(setPayload(res, { message: "Failed" })); }
  },
};

export default profileController;
