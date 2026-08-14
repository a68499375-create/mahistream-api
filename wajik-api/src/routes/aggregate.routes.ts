import { Router } from "express";
import { serverCache } from "@middlewares/cache.js";
import aggregateController from "@controllers/aggregate.controller.js";

const router = Router();

router.get("/search", serverCache(15), aggregateController.search);
router.get("/home", serverCache(10), aggregateController.home);
router.get("/schedule", serverCache(60), aggregateController.schedule);

export default router;
