import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Ensure the db file is created in a reliable location
const dbPath = path.resolve(__dirname, '../../mahistream.sqlite');
export const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('FATAL: Error opening database', err.message);
        process.exit(1);
    }
    else {
        console.log('Connected to the SQLite database at', dbPath);
        // Initialize Tables
        db.serialize(() => {
            // Users Table
            db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        uid TEXT UNIQUE,
        username TEXT UNIQUE,
        display_name TEXT,
        email TEXT,
        picture TEXT,
        background_url TEXT,
        bio TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
            // History Table
            db.run(`CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        anime_id TEXT,
        title TEXT,
        poster_url TEXT,
        episode TEXT,
        source TEXT DEFAULT 'otakudesu',
        watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        progress_seconds INTEGER DEFAULT 0,
        duration_seconds INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`);
            // Bookmarks Table
            db.run(`CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        anime_id TEXT,
        title TEXT,
        poster_url TEXT,
        source TEXT DEFAULT 'otakudesu',
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        UNIQUE(user_id, anime_id)
      )`);
            // Comments — per-episode/anime, threaded via parent_id, dengan likes.
            db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        anime_id TEXT NOT NULL,
        episode TEXT,
        parent_id INTEGER,
        body TEXT NOT NULL,
        likes INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (parent_id) REFERENCES comments (id)
      )`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_comments_anime ON comments (anime_id, created_at DESC)`);
            // Comment likes — track per-user supaya tidak bisa like 2x.
            db.run(`CREATE TABLE IF NOT EXISTS comment_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        comment_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, comment_id),
        FOREIGN KEY (comment_id) REFERENCES comments (id) ON DELETE CASCADE
      )`);
            // Sign-in streak — sekali per hari, hari berturut-turut dihitung sebagai streak.
            db.run(`CREATE TABLE IF NOT EXISTS signin_streak (
        user_id TEXT PRIMARY KEY,
        last_signin_date TEXT,
        current_streak INTEGER DEFAULT 0,
        longest_streak INTEGER DEFAULT 0,
        total_signins INTEGER DEFAULT 0
      )`);
            // Collection points — gamifikasi. Source: watch (5pt), comment (3pt),
            // signin (10pt per hari, +5pt bonus tiap streak 7 hari).
            db.run(`CREATE TABLE IF NOT EXISTS user_points (
        user_id TEXT PRIMARY KEY,
        points INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
            db.run(`CREATE TABLE IF NOT EXISTS points_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        delta INTEGER NOT NULL,
        meta TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_points_log_user ON points_log (user_id, created_at DESC)`);
            // Anime stats — cache view count untuk recommendations berbasis popularity.
            db.run(`CREATE TABLE IF NOT EXISTS anime_stats (
        anime_id TEXT PRIMARY KEY,
        title TEXT,
        poster_url TEXT,
        source TEXT DEFAULT 'kuramanime',
        genres TEXT,
        view_count INTEGER DEFAULT 0,
        last_viewed DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
        });
    }
});
// Helper functions for DB queries using Promises
export const queryDb = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err)
                reject(err);
            else
                resolve(rows);
        });
    });
};
export const runDb = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err)
                reject(err);
            else
                resolve(this);
        });
    });
};
