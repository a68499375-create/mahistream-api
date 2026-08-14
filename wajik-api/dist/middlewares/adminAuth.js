const ALLOWED_EMAIL = "sapapenontonbg@gmail.com";
export default function adminAuth(req, res, next) {
    const email = req.query.email || req.headers["x-user-email"];
    if (!email || email.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) {
        return res.status(403).json({ error: "Unauthorized" });
    }
    next();
}
