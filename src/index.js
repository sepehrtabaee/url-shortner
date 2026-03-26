import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { supabase } from "./db/supabase.js";
import { getCachedUrl, cacheUrl, redis } from "./db/redis.js";
import { router as urlsRouter } from "./routes/urls.js";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";

const app = express();
app.use(cors({ origin: "https://sepehrtabaee.com" }));
app.use(express.json());


const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                  // requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => redis.sendCommand(args),
  }),
});

app.use(limiter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api/urls", urlsRouter);

// ── Redirect route ────────────────────────────────────────────────────────────
app.get("/:code", async (req, res) => {
  const { code } = req.params;

  // 1. Cache hit
  let record = await getCachedUrl(code);

  // 2. Cache miss — query Supabase
  if (!record) {
    const { data, error } = await supabase
      .from("short_urls")
      .select("long_url, is_active, expiration_date")
      .eq("short_code", code)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Short URL not found" });
    }

    record = data;
    await cacheUrl(code, {
      long_url: data.long_url,
      is_active: data.is_active,
      expiration_date: data.expiration_date,
    });
  }

  // 3. Guard: inactive or expired
  if (!record.is_active) {
    return res.status(410).json({ error: "This short URL has been deactivated" });
  }

  if (new Date(record.expiration_date) < new Date()) {
    return res.status(410).json({ error: "This short URL has expired" });
  }

  // 4. Log the click asynchronously — don't block the redirect
  supabase
    .from("url_clicks")
    .insert({
      ip_address: req.ip,
      user_agent: req.headers["user-agent"] ?? null,
    })
    .then(({ error }) => {
      if (error) console.error("[click] failed to log:", error.message);
    });

  // 5. Redirect
  return res.redirect(301, record.long_url);
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});
