import express from "express";
import { config } from "./config.js";
import { supabase } from "./db/supabase.js";
import { getCachedUrl, cacheUrl } from "./db/redis.js";
import { router as urlsRouter } from "./routes/urls.js";

const app = express();
app.use(express.json());

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
