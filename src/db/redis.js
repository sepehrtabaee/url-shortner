import { createClient } from "redis";

export const redis = createClient({
  username: "default",
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: 13786,
  },
});

redis.on("connect", () => console.log("[redis] connected"));
redis.on("error", (err) => console.error("[redis] error:", err.message));

await redis.connect();

// TTL helpers
export const CACHE_TTL_SECONDS = 3600; // 1 hour

export async function cacheUrl(shortCode, payload, ttlSeconds = CACHE_TTL_SECONDS) {
  await redis.set(`url:${shortCode}`, JSON.stringify(payload), { EX: ttlSeconds });
}

export async function getCachedUrl(shortCode) {
  const raw = await redis.get(`url:${shortCode}`);
  return raw ? JSON.parse(raw) : null;
}

export async function invalidateUrl(shortCode) {
  await redis.del(`url:${shortCode}`);
}
