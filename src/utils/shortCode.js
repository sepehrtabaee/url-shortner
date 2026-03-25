// Short code generator: timestamp (seconds since custom epoch) + random bits → Base62
//
// Layout (34 bits total → fits in 6 Base62 chars, since 62^6 ≈ 56.8 billion > 2^35):
//   bits [33..4]  — 30 bits of seconds since EPOCH  (~34 years of range)
//   bits [3..0]   — 4 bits of random noise           (16 slots/second, low collision risk)

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const CODE_LENGTH = 6;
const EPOCH_MS = 1704067200000; // 2024-01-01 00:00:00 UTC
const RANDOM_BITS = 4;

function toBase62(num) {
  let result = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    result = BASE62[num % 62] + result;
    num = Math.floor(num / 62);
  }
  return result;
}

export function generateShortCode() {
  const tsSeconds = Math.floor((Date.now() - EPOCH_MS) / 1000);
  const randomBits = Math.floor(Math.random() * (1 << RANDOM_BITS));
  const combined = (tsSeconds << RANDOM_BITS) | randomBits;
  return toBase62(combined);
}
