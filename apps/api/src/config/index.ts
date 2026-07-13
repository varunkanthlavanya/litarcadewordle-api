import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  adminSecretKey: required("ADMIN_SECRET_KEY"),
  adminSessionTtlHours: Number(process.env.ADMIN_SESSION_TTL_HOURS ?? 12),
  playerSessionTtlHours: Number(process.env.PLAYER_SESSION_TTL_HOURS ?? 6),
  eventTimezone: process.env.EVENT_TIMEZONE ?? "Asia/Kolkata",
} as const;
