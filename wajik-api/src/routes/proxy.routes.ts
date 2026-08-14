import { Router } from "express";
import proxyController from "../controllers/proxy.controller.js";

const proxyRouter = Router();

proxyRouter.get("/stream", proxyController.streamProxy);

export default proxyRouter;
