import { Router } from "express";
import { serverCache } from "../middlewares/cache.js";
import kuramanimeController from "../controllers/kuramanime.controller.js";
const kuramanimeRouter = Router();
// Cache TTL dalam menit. Endpoint listing/detail aman di-cache lama karena
// kontennya relatif stabil; resolve-stream tidak di-cache karena URL embed
// bisa berubah token-nya. Detail anime di-cache 6 jam supaya Conan/One Piece
// (1000+ episode) tidak harus harvest 11+ halaman tiap kali user buka.
kuramanimeRouter.get("/search", serverCache(30), kuramanimeController.search);
kuramanimeRouter.get("/live-search", serverCache(5), kuramanimeController.liveSearch);
kuramanimeRouter.get("/latest", serverCache(10), kuramanimeController.latest);
kuramanimeRouter.get("/schedule", serverCache(60), kuramanimeController.schedule);
kuramanimeRouter.get("/genres", serverCache(1440), kuramanimeController.genres);
kuramanimeRouter.get("/browse", serverCache(30), kuramanimeController.browse);
kuramanimeRouter.get("/anime/*", serverCache(360), kuramanimeController.animeDetails);
kuramanimeRouter.get("/episode/*", serverCache(15), kuramanimeController.episodeDetails);
kuramanimeRouter.get("/resolve-stream", kuramanimeController.resolveStream);
kuramanimeRouter.get("/stream-proxy", kuramanimeController.streamProxy);
kuramanimeRouter.get("/iframe-proxy", serverCache(10), kuramanimeController.iframeProxy);
export default kuramanimeRouter;
