import express from "express";
import { serverCache } from "../middlewares/cache.js";
import nekopoiController from "../controllers/nekopoi.controller.js";
const router = express.Router();
router.get("/latest", serverCache(15), nekopoiController.latest);
router.get("/search", serverCache(20), nekopoiController.search);
router.get("/category", serverCache(15), nekopoiController.category);
router.get("/index", serverCache(360), nekopoiController.index);
router.get("/detail", serverCache(30), nekopoiController.detail);
router.get("/stream", nekopoiController.stream);
router.get("/iframe-proxy", serverCache(10), nekopoiController.iframeProxy);
// Aliases for compatibility with VideoPlayer generic routing
router.get("/resolve-stream", nekopoiController.stream);
router.get("/anime/:id(*)", serverCache(30), (req, res, next) => {
    req.query.url = req.params.id;
    return nekopoiController.detail(req, res);
});
router.get("/episode/:id(*)", serverCache(20), (req, res, next) => {
    req.query.url = req.params.id;
    return nekopoiController.detail(req, res);
});
export default router;
