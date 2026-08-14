import type { Request, Response } from "express";

// Room state untuk fitur "nonton bareng".
// Implementasi disengaja sederhana: state disimpan di memori proses backend
// dan disinkronkan oleh frontend dengan polling pendek tiap ~1.5 detik.
// Cukup untuk grup teman 2-10 orang tanpa harus pasang WebSocket / Redis.

interface Participant {
  userId: string;
  name: string;
  lastSeen: number;
}

interface Room {
  id: string;
  hostId: string;
  videoId: string; // animeId atau path video
  source: string;
  episodeId?: string;
  positionSec: number;
  isPlaying: boolean;
  updatedAt: number;
  participants: Map<string, Participant>;
  chat: Array<{ ts: number; userId: string; name: string; msg: string }>;
}

const rooms = new Map<string, Room>();

// Bersihkan room kosong/tua agar memory tidak menumpuk.
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms.entries()) {
    // Buang peserta yang tidak heartbeat > 30 detik.
    for (const [pid, p] of room.participants) {
      if (now - p.lastSeen > 30_000) room.participants.delete(pid);
    }
    // Buang room yang sudah tidak ada peserta atau lebih dari 6 jam tak ada update.
    if (room.participants.size === 0 || now - room.updatedAt > 6 * 60 * 60_000) {
      rooms.delete(id);
    }
  }
}, 30_000);

const makeRoomId = () => {
  // 6 karakter, mudah dibagikan.
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
};

export const createRoom = (req: Request, res: Response) => {
  const { userId, name, videoId, source, episodeId } = req.body || {};
  if (!userId || !videoId) {
    return res.status(400).json({ error: "userId and videoId are required" });
  }
  let id = makeRoomId();
  while (rooms.has(id)) id = makeRoomId();
  const now = Date.now();
  const room: Room = {
    id,
    hostId: userId,
    videoId,
    source: source || "otakudesu",
    episodeId,
    positionSec: 0,
    isPlaying: false,
    updatedAt: now,
    participants: new Map([[userId, { userId, name: name || "Host", lastSeen: now }]]),
    chat: [],
  };
  rooms.set(id, room);
  return res.json({ roomId: id, isHost: true });
};

export const joinRoom = (req: Request, res: Response) => {
  const { roomId, userId, name } = req.body || {};
  if (!roomId || !userId) {
    return res.status(400).json({ error: "roomId and userId are required" });
  }
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: "Room not found" });
  room.participants.set(userId, { userId, name: name || "Guest", lastSeen: Date.now() });
  return res.json({
    roomId,
    isHost: room.hostId === userId,
    videoId: room.videoId,
    source: room.source,
    episodeId: room.episodeId,
    positionSec: room.positionSec,
    isPlaying: room.isPlaying,
  });
};

export const stateRoom = (req: Request, res: Response) => {
  const roomId = req.params.roomId as string;
  const userId = (req.query.userId as string) || "";
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (userId) {
    const p = room.participants.get(userId);
    if (p) p.lastSeen = Date.now();
    else room.participants.set(userId, { userId, name: "Guest", lastSeen: Date.now() });
  }
  return res.json({
    roomId,
    hostId: room.hostId,
    videoId: room.videoId,
    source: room.source,
    episodeId: room.episodeId,
    positionSec: room.positionSec,
    isPlaying: room.isPlaying,
    updatedAt: room.updatedAt,
    participants: Array.from(room.participants.values()).map((p) => ({ userId: p.userId, name: p.name })),
    chat: room.chat.slice(-50),
  });
};

export const updateRoom = (req: Request, res: Response) => {
  const roomId = req.params.roomId as string;
  const { userId, positionSec, isPlaying, episodeId } = req.body || {};
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (userId !== room.hostId) {
    return res.json({ ok: true, ignored: true });
  }
  if (typeof positionSec === "number") room.positionSec = positionSec;
  if (typeof isPlaying === "boolean") room.isPlaying = isPlaying;
  if (typeof episodeId === "string") room.episodeId = episodeId;
  room.updatedAt = Date.now();
  return res.json({ ok: true });
};

export const chatRoom = (req: Request, res: Response) => {
  const roomId = req.params.roomId as string;
  const { userId, msg } = req.body || {};
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: "Room not found" });
  const p = room.participants.get(userId);
  if (!p) return res.status(403).json({ error: "Not a participant" });
  const trimmed = String(msg || "").trim().slice(0, 300);
  if (!trimmed) return res.status(400).json({ error: "Empty message" });
  room.chat.push({ ts: Date.now(), userId, name: p.name, msg: trimmed });
  if (room.chat.length > 100) room.chat.splice(0, room.chat.length - 100);
  return res.json({ ok: true });
};

export const leaveRoom = (req: Request, res: Response) => {
  const roomId = req.params.roomId as string;
  const { userId } = req.body || {};
  const room = rooms.get(roomId);
  if (!room) return res.json({ ok: true });
  room.participants.delete(userId);
  if (room.participants.size === 0) rooms.delete(roomId);
  return res.json({ ok: true });
};
