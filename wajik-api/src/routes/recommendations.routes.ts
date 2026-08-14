import { Router } from "express";
import recommendationsController from "../controllers/recommendations.controller.js";

const recommendationsRouter = Router();

recommendationsRouter.post("/view", recommendationsController.track);
recommendationsRouter.get("/popular", recommendationsController.popular);
recommendationsRouter.get("/similar", recommendationsController.similar);
recommendationsRouter.get("/for-you", recommendationsController.forYou);

export default recommendationsRouter;
