import { Router } from "express";
import { supabase } from "../db/supabase.js";
import { cacheUrl, getCachedUrl, invalidateUrl } from "../db/redis.js";
import { generateShortCode } from "../utils/shortCode.js";
import { config } from "../config.js";

export const router = Router();

// POST /api/urls — create a short URL
router.post("/", async (req, res) => {
  const { long_url, expiration_date } = req.body;

  if (!long_url) {
    return res.status(400).json({ error: "long_url is required" });
  }

  try {
    new URL(long_url);
  } catch {
    return res.status(400).json({ error: "long_url is not a valid URL" });
  }

  // Retry loop handles the rare case where a generated code already exists
  for (let attempt = 0; attempt < 5; attempt++) {
    const short_code = generateShortCode();

    const insertPayload = { long_url, short_code };
    if (expiration_date) insertPayload.expiration_date = expiration_date;

    const { data, error } = await supabase
      .from("short_urls")
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation (short_code collision)
      if (error.code === "23505") continue;
      console.error("[create] supabase error:", error);
      return res.status(500).json({ error: "Failed to create short URL" });
    }

    await cacheUrl(short_code, {
      long_url: data.long_url,
      is_active: data.is_active,
      expiration_date: data.expiration_date,
    });

    return res.status(201).json({
      id: data.id,
      short_code: data.short_code,
      short_url: `${config.baseUrl}/${data.short_code}`,
      long_url: data.long_url,
      expiration_date: data.expiration_date,
      created_at: data.created_at,
    });
  }

  return res.status(500).json({ error: "Could not generate a unique short code" });
});

// GET /api/urls/:code — fetch URL record (no redirect)
router.get("/:code", async (req, res) => {
  const { code } = req.params;

  let record = await getCachedUrl(code);

  if (!record) {
    const { data, error } = await supabase
      .from("short_urls")
      .select("long_url, is_active, expiration_date, created_at")
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

  return res.json({
    short_code: code,
    short_url: `${config.baseUrl}/${code}`,
    long_url: record.long_url,
    is_active: record.is_active,
    expiration_date: record.expiration_date,
  });
});

// DELETE /api/urls/:code — deactivate a short URL
router.delete("/:code", async (req, res) => {
  const { code } = req.params;

  const { data, error } = await supabase
    .from("short_urls")
    .update({ is_active: false })
    .eq("short_code", code)
    .select("short_code")
    .single();

  if (error || !data) {
    return res.status(404).json({ error: "Short URL not found" });
  }

  await invalidateUrl(code);

  return res.json({ message: "Short URL deactivated", short_code: code });
});
