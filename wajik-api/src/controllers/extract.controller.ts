import type { Request, Response } from "express";
import extractStream from "../helpers/extractStream.js";
import { validateProxyUrl } from "../helpers/validateUrl.js";

const extractController = {
  async extract(req: Request, res: Response) {
    try {
      const url = req.query.url as string;
      if (!url) {
        return res.status(400).json({ error: "Missing url parameter" });
      }

      const { valid, reason } = validateProxyUrl(url);
      if (!valid) return res.status(400).json({ error: reason });
      
      const streamUrl = await extractStream(url);
      if (streamUrl) {
        return res.json({ streamUrl });
      } else {
        return res.status(404).json({ error: "Could not extract stream URL" });
      }
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
};

export default extractController;
