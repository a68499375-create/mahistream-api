import { clientCache } from "@middlewares/cache.js";
import {
  securityHeaders,
  corsWhitelist,
  rateLimit,
  inputSanitizer,
} from "@middlewares/security.js";
import appConfig from "@configs/app.config.js";
import express from "express";
import errorHandler from "@middlewares/errorHandler.js";
import otakudesuRouter from "@routes/otakudesu.routes.js";
import kuramanimeRouter from "@routes/kuramanime.routes.js";
import nekopoiRouter from "@routes/nekopoi.route.js";
import userRouter from "./routes/user.routes.js";
import setPayload from "@helpers/setPayload.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { PORT } = appConfig;
const app = express();

// Aktifkan trust proxy supaya req.ip ambil dari X-Forwarded-For (di belakang
// nginx). Penting untuk rate-limit per-IP.
app.set("trust proxy", 1);

// Security stack — diaktifkan SEBELUM body parser supaya request mencurigakan
// ke-reject dengan biaya minimal.
app.use(securityHeaders);
app.use(corsWhitelist);
// Limit global: 240 request per menit per (IP × path-prefix). FlareSolverr
// endpoint (kuramanime) akan dibatasi lebih ketat di route-nya sendiri kalau
// perlu.
app.use(rateLimit({ max: 240, windowMs: 60_000 }));
app.use(express.json({ limit: "256kb" }));
app.use(inputSanitizer);
app.use(clientCache(1));

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "../public/uploads")));

app.get("/", (req, res) => {
  const routes: IRouteData[] = [
    {
      method: "GET",
      path: "/otakudesu",
      description: "Otakudesu",
      pathParams: [],
      queryParams: [],
    },
    {
      method: "GET",
      path: "/kuramanime",
      description: "Kuramanime",
      pathParams: [],
      queryParams: [],
    },
    {
      method: "GET",
      path: "/user",
      description: "User",
      pathParams: [],
      queryParams: [],
    },
  ];

  res.json(
    setPayload(res, {
      data: { routes },
    })
  );
});

import aggregateRouter from "@routes/aggregate.routes.js";
import extractRouter from "@routes/extract.routes.js";
import proxyRouter from "@routes/proxy.routes.js";
import watchpartyRouter from "@routes/watchparty.routes.js";
import notificationsRouter from "./routes/notifications.routes.js";
import commentsRouter from "./routes/comments.routes.js";
import recommendationsRouter from "./routes/recommendations.routes.js";
import profileRouter from "./routes/profile.routes.js";
import downloadRouter from "./routes/download.routes.js";
import adminRouter from "./routes/admin.routes.js";
import { startReleaseTracker } from "./services/releaseTracker.js";

app.use("/otakudesu", otakudesuRouter);
app.use("/kuramanime", kuramanimeRouter);
app.use("/nekopoi", nekopoiRouter);
app.use("/aggregate", aggregateRouter);
app.use("/extract-stream", extractRouter);
app.use("/proxy", proxyRouter);
app.use("/user", userRouter);
app.use("/watchparty", watchpartyRouter);
app.use("/notifications", notificationsRouter);
app.use("/comments", commentsRouter);
app.use("/recommendations", recommendationsRouter);
app.use("/profile", profileRouter);
app.use("/download", downloadRouter);
app.use("/admin", adminRouter);

// Aliases for /api and root paths to ensure compatibility with all frontend/E2E API calls
app.use("/api/otakudesu", otakudesuRouter);
app.use("/api/kuramanime", kuramanimeRouter);
app.use("/api/aggregate", aggregateRouter);
app.use("/api/user", userRouter);
app.use("/api/recommendations", recommendationsRouter);
app.use("/api/comments", commentsRouter);
app.use("/api/admin", adminRouter);
app.use("/api", otakudesuRouter);
app.use("/api", kuramanimeRouter);
app.use("/api", aggregateRouter);
app.use("/api", userRouter);
app.use("/", otakudesuRouter);
app.use("/", kuramanimeRouter);
app.use("/", aggregateRouter);
app.use("/", userRouter);

app.use(errorHandler);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`server is running on http://localhost:${PORT}`);
  // Kick off the release tracker after the HTTP listener is ready so a slow
  // FlareSolverr boot can't block the port from binding.
  startReleaseTracker().catch((e) => console.warn("releaseTracker failed to start", e));

  // Warm up FlareSolverr sessions agar Cloudflare clearance ready.
  const warmUpSessions = async () => {
    const FLARE_URL = process.env.FLARESOLVERR_URL || "http://127.0.0.1:8191/v1";
    const sessions = [
      { session: "kuramanime", url: "https://v18.kuramanime.ing/" },
      { session: "otakudesu", url: "https://otakudesu.blog/" },
      { session: "nekopoi", url: "https://nekopoi.care/" },
    ];
    for (const { session, url } of sessions) {
      try {
        await fetch(FLARE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd: "request.get", url, maxTimeout: 90000, session }),
        });
        console.log(`[warmup] ${session} session warmed`);
      } catch (e: any) {
        console.warn(`[warmup] ${session} failed:`, e?.message);
      }
    }
  };

  // Initial warm-up 10s after boot, then every 25 min
  setTimeout(() => {
    warmUpSessions();
    setInterval(warmUpSessions, 25 * 60 * 1000);
  }, 10_000);
});
