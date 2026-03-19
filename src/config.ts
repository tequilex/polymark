import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(8080),
  POLL_INTERVAL_SEC: z.coerce.number().int().positive().default(60),
  TOP_MARKETS_LIMIT: z.coerce.number().int().positive().default(100),
  ALERT_MULTIPLIER: z.coerce.number().positive().default(5),
  ALERT_MIN_VOLUME: z.coerce.number().nonnegative().default(300),
  ALERT_COOLDOWN_HOURS: z.coerce.number().int().positive().default(6),
  BASELINE_DAYS: z.coerce.number().int().positive().default(7),
  RESOLVE_EVERY_N_ITERATIONS: z.coerce.number().int().positive().default(10),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  REQUEST_RETRIES: z.coerce.number().int().nonnegative().default(3),
  REQUEST_CONCURRENCY: z.coerce.number().int().positive().default(8),
  DB_PATH: z.string().default('./polymarket.db'),
  CORS_ORIGIN: z.string().default('http://localhost:5173')
});

const parsedEnv = envSchema.parse(process.env);

export const config = {
  nodeEnv: parsedEnv.NODE_ENV ?? 'development',
  port: parsedEnv.PORT,
  pollIntervalSec: parsedEnv.POLL_INTERVAL_SEC,
  topMarketsLimit: parsedEnv.TOP_MARKETS_LIMIT,
  alertMultiplier: parsedEnv.ALERT_MULTIPLIER,
  alertMinVolume: parsedEnv.ALERT_MIN_VOLUME,
  alertCooldownHours: parsedEnv.ALERT_COOLDOWN_HOURS,
  baselineDays: parsedEnv.BASELINE_DAYS,
  resolveEveryNIterations: parsedEnv.RESOLVE_EVERY_N_ITERATIONS,
  requestTimeoutMs: parsedEnv.REQUEST_TIMEOUT_MS,
  requestRetries: parsedEnv.REQUEST_RETRIES,
  requestConcurrency: parsedEnv.REQUEST_CONCURRENCY,
  dbPath: parsedEnv.DB_PATH,
  corsOrigin: parsedEnv.CORS_ORIGIN
} as const;
