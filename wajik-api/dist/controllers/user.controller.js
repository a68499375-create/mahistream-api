import { queryDb, runDb } from '../db/database.js';
export const saveHistory = async (req, res) => {
    try {
        const { userId, animeId, title, posterUrl, poster_url, episode, source, progressSeconds, progress_seconds, durationSeconds, duration_seconds } = req.body;
        if (!userId || !animeId) {
            return res.status(400).json({ error: 'userId and animeId are required' });
        }
        // Find actual UID or auto-create
        let userRows = await queryDb('SELECT uid FROM users WHERE email = ? OR username = ? OR uid = ?', [userId, userId, userId]);
        let actualUid;
        if (userRows.length === 0) {
            // Auto-create user
            actualUid = 'USR-' + Math.random().toString(36).substr(2, 9).toUpperCase();
            const isEmail = userId.includes('@');
            const email = isEmail ? userId : `${userId}@local.host`;
            const username = isEmail ? userId.split('@')[0] : userId;
            await runDb(`INSERT INTO users (id, uid, email, username, display_name) VALUES (?, ?, ?, ?, ?)`, [actualUid, actualUid, email, username, username]);
        }
        else {
            actualUid = userRows[0].uid;
        }
        const src = source || 'otakudesu';
        const progressSec = progressSeconds ?? progress_seconds ?? 0;
        const durationSec = durationSeconds ?? duration_seconds ?? 0;
        const pUrl = posterUrl || poster_url || '';
        const existing = await queryDb('SELECT id, duration_seconds FROM history WHERE user_id = ? AND anime_id = ?', [actualUid, animeId]);
        if (existing.length > 0) {
            const finalDurationSec = durationSec || existing[0].duration_seconds || 0;
            await runDb(`UPDATE history SET episode = ?, progress_seconds = ?, duration_seconds = ?, watched_at = CURRENT_TIMESTAMP WHERE user_id = ? AND anime_id = ?`, [episode, progressSec, finalDurationSec, actualUid, animeId]);
        }
        else {
            await runDb(`INSERT INTO history (user_id, anime_id, title, poster_url, episode, source, progress_seconds, duration_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [actualUid, animeId, title, pUrl, episode, src, progressSec, durationSec]);
        }
        res.status(200).json({ message: 'History saved successfully' });
    }
    catch (error) {
        console.error('saveHistory error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
export const getHistory = async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }
        const userRows = await queryDb('SELECT uid FROM users WHERE email = ? OR username = ? OR uid = ?', [userId, userId, userId]);
        if (userRows.length === 0) {
            return res.status(200).json([]); // Return empty if user not found
        }
        const actualUid = userRows[0].uid;
        const history = await queryDb(`SELECT 
        id, 
        anime_id as anime_id, 
        title, 
        poster_url as posterUrl, 
        poster_url as poster_url, 
        episode, 
        watched_at as watchedAt, 
        watched_at as last_watched_at, 
        source, 
        progress_seconds as progress_seconds,
        duration_seconds as duration_seconds
       FROM history 
       WHERE user_id = ? 
       ORDER BY watched_at DESC 
       LIMIT 100`, [actualUid]);
        res.status(200).json(history);
    }
    catch (error) {
        console.error('getHistory error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
export const deleteHistory = async (req, res) => {
    try {
        const { userId, animeId } = req.query;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }
        const userRows = await queryDb('SELECT uid FROM users WHERE email = ? OR username = ? OR uid = ?', [userId, userId, userId]);
        if (userRows.length === 0) {
            return res.status(200).json({ message: 'User not found, nothing to delete' });
        }
        const actualUid = userRows[0].uid;
        if (animeId) {
            await runDb('DELETE FROM history WHERE user_id = ? AND anime_id = ?', [actualUid, animeId]);
            res.status(200).json({ message: 'History item deleted' });
        }
        else {
            await runDb('DELETE FROM history WHERE user_id = ?', [actualUid]);
            res.status(200).json({ message: 'All history cleared' });
        }
    }
    catch (error) {
        console.error('deleteHistory error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
export const toggleBookmark = async (req, res) => {
    try {
        const { userId, animeId, title, posterUrl } = req.body;
        if (!userId || !animeId) {
            return res.status(400).json({ error: 'userId and animeId are required' });
        }
        // Find actual UID or auto-create
        let userRows = await queryDb('SELECT uid FROM users WHERE email = ? OR username = ? OR uid = ?', [userId, userId, userId]);
        let actualUid;
        if (userRows.length === 0) {
            // Auto-create user
            actualUid = 'USR-' + Math.random().toString(36).substr(2, 9).toUpperCase();
            const isEmail = userId.includes('@');
            const email = isEmail ? userId : `${userId}@local.host`;
            const username = isEmail ? userId.split('@')[0] : userId;
            await runDb(`INSERT INTO users (id, uid, email, username, display_name) VALUES (?, ?, ?, ?, ?)`, [actualUid, actualUid, email, username, username]);
        }
        else {
            actualUid = userRows[0].uid;
        }
        const source = req.body.source || 'otakudesu';
        const existing = await queryDb('SELECT id FROM bookmarks WHERE user_id = ? AND anime_id = ?', [actualUid, animeId]);
        if (existing.length > 0) {
            await runDb('DELETE FROM bookmarks WHERE id = ?', [existing[0].id]);
            res.status(200).json({ message: 'Bookmark removed', isBookmarked: false });
        }
        else {
            await runDb(`INSERT INTO bookmarks (user_id, anime_id, title, poster_url, source) VALUES (?, ?, ?, ?, ?)`, [actualUid, animeId, title, posterUrl, source]);
            res.status(200).json({ message: 'Bookmark added', isBookmarked: true });
        }
    }
    catch (error) {
        console.error('toggleBookmark error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
export const getBookmarks = async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }
        const userRows = await queryDb('SELECT uid FROM users WHERE email = ? OR username = ? OR uid = ?', [userId, userId, userId]);
        if (userRows.length === 0) {
            return res.status(200).json([]);
        }
        const actualUid = userRows[0].uid;
        const bookmarks = await queryDb(`SELECT anime_id as id, title, poster_url as posterUrl, source 
       FROM bookmarks 
       WHERE user_id = ? 
       ORDER BY added_at DESC`, [actualUid]);
        res.status(200).json(bookmarks);
    }
    catch (error) {
        console.error('getBookmarks error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
export const getProfile = async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }
        // Auto-create user if not exists with a generated UID
        const existing = await queryDb(`SELECT * FROM users WHERE id = ?`, [userId]);
        if (existing.length === 0) {
            const newUid = Math.floor(10000000 + Math.random() * 90000000).toString(); // 8 digit UID
            await runDb(`INSERT INTO users (id, uid, username, display_name) VALUES (?, ?, ?, ?)`, [userId, newUid, 'user_' + newUid, 'User']);
        }
        const userProfile = await queryDb(`SELECT * FROM users WHERE id = ?`, [userId]);
        res.status(200).json(userProfile[0]);
    }
    catch (error) {
        console.error('getProfile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
export const updateProfile = async (req, res) => {
    try {
        const { userId, display_name, username, bio, picture, background_url } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }
        // Check if username is taken by someone else
        if (username) {
            const usernameCheck = await queryDb(`SELECT id FROM users WHERE username = ? AND id != ?`, [username, userId]);
            if (usernameCheck.length > 0) {
                return res.status(400).json({ error: 'Username is already taken' });
            }
        }
        await runDb(`UPDATE users 
       SET display_name = COALESCE(?, display_name),
           username = COALESCE(?, username),
           bio = COALESCE(?, bio),
           picture = COALESCE(?, picture),
           background_url = COALESCE(?, background_url)
       WHERE id = ?`, [display_name, username, bio, picture, background_url, userId]);
        const updatedProfile = await queryDb(`SELECT * FROM users WHERE id = ?`, [userId]);
        res.status(200).json({ message: 'Profile updated successfully', profile: updatedProfile[0] });
    }
    catch (error) {
        console.error('updateProfile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
