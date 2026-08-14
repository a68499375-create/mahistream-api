import { Router } from "express";
import samehadakuController from "@controllers/samehadaku.controller.js";

const router = Router();

router.get("/search", samehadakuController.search);
router.get("/anime/:id", samehadakuController.animeDetails);
router.get("/episode/:id", samehadakuController.episodeDetails);
router.get("/resolve-stream", samehadakuController.resolveStream);

export default router;
