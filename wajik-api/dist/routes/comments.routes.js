import { Router } from "express";
import commentsController from "../controllers/comments.controller.js";
const commentsRouter = Router();
// GET semua comment untuk anime (+episode optional).
commentsRouter.get("/", commentsController.list);
// POST create comment baru.
commentsRouter.post("/", commentsController.create);
// SSE realtime stream — subscriber dapat event saat ada comment baru/delete/like.
commentsRouter.get("/sse/stream", commentsController.sseStream);
// Like toggle (idempotent per-user).
commentsRouter.post("/:id/like", commentsController.like);
// Delete (hanya pemilik).
commentsRouter.delete("/:id", commentsController.remove);
export default commentsRouter;
