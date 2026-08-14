import type { Request, Response, NextFunction } from "express";

const ALLOWED_EMAIL = "sapapenontonbg@gmail.com";

export default function adminAuth(req: Request, res: Response, next: NextFunction) {
  const email = (req.query.email as string) || (req.headers["x-user-email"] as string);
  if (!email || email.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
}
