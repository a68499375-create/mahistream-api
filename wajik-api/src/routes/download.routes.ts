import { Router } from "express";
import downloadController from "@controllers/download.controller.js";

const downloadRouter = Router();

// Get download options for an episode (multi-quality, multi-mirror)
downloadRouter.get("/options", downloadController.getDownloadOptions);

// Proxy download with Range header support (resume capability)
downloadRouter.get("/proxy", downloadController.download);

export default downloadRouter;