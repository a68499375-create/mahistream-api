import { Router } from "express";
import extractController from "../controllers/extract.controller.js";
const extractRouter = Router();
extractRouter.get("/", extractController.extract);
export default extractRouter;
