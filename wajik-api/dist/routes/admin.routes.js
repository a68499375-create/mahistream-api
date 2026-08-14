import { Router } from "express";
import adminController from "../controllers/admin.controller.js";
import adminAuth from "../middlewares/adminAuth.js";
const router = Router();
router.get("/status", adminAuth, adminController.status);
router.get("/flare", adminAuth, adminController.flareStatus);
router.get("/cache", adminAuth, adminController.cacheStats);
router.get("/system", adminAuth, adminController.systemInfo);
export default router;
