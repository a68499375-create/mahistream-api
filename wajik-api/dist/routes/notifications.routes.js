import { Router } from "express";
import { ackRelease, getPendingReleases, } from "../services/releaseTracker.js";
const router = Router();
// GET /notifications/pending?since=<unix_ms>
// Returns release entries detected after `since` (or all if omitted).
router.get("/pending", (req, res) => {
    const sinceRaw = req.query.since;
    const since = sinceRaw ? parseInt(sinceRaw, 10) : 0;
    const releases = getPendingReleases(since && !isNaN(since) ? since : undefined);
    res.json({ releases, serverTime: Date.now() });
});
// GET /notifications/ack?id=<animeId>&episode=<num>
// Optional: lets the client mark a release as consumed so it won't reappear.
router.get("/ack", (req, res) => {
    const animeId = String(req.query.id || "");
    const episode = parseInt(String(req.query.episode || ""), 10);
    if (!animeId || isNaN(episode)) {
        return res.status(400).json({ ok: false, message: "id and episode required" });
    }
    const removed = ackRelease(animeId, episode);
    return res.json({ ok: true, removed });
});
export default router;
