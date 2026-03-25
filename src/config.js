import "dotenv/config";

export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  baseUrl: process.env.BASE_URL ?? "http://localhost:3000",
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_KEY,
  }
};

for (const [key, value] of Object.entries(config.supabase)) {
  if (!value) throw new Error(`Missing env var for supabase.${key}`);
}
