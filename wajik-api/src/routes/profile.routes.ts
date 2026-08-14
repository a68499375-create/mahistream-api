import { Router } from "express";
import profileController from "../controllers/profile.controller.js";

const profileRouter = Router();

profileRouter.post("/signin", profileController.signin);
profileRouter.get("/streak", profileController.streak);
profileRouter.get("/points", profileController.points);
profileRouter.get("/leaderboard", profileController.leaderboard);
profileRouter.get("/me", profileController.me);
profileRouter.post("/update", profileController.update);
profileRouter.get("/public/:userId", profileController.public);

export default profileRouter;
