export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  ADMIN_TELEGRAM_ID: string;
  WEBHOOK_SECRET: string;
  PUBLIC_WORKER_URL?: string;
  CONVERSATION_STATE_TTL_MINUTES?: string;
  EXPORT_MAX_ROWS?: string;
  EXPORT_MAX_BYTES?: string;
}

export interface AppConfig {
  botToken: string;
  adminTelegramId: string;
  webhookSecret: string;
  stateTtlMinutes: number;
  exportMaxRows: number;
  exportMaxBytes: number;
}

const positiveInteger = (value: string | undefined, fallback: number, maximum: number): number => {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : fallback;
};

export const readConfig = (env: Env): AppConfig => {
  if (!env.BOT_TOKEN || !env.ADMIN_TELEGRAM_ID || !env.WEBHOOK_SECRET) {
    throw new Error("Required service configuration is missing.");
  }
  if (!/^[1-9]\d*$/.test(env.ADMIN_TELEGRAM_ID)) {
    throw new Error("Administrator configuration is invalid.");
  }
  return {
    botToken: env.BOT_TOKEN,
    adminTelegramId: env.ADMIN_TELEGRAM_ID,
    webhookSecret: env.WEBHOOK_SECRET,
    stateTtlMinutes: positiveInteger(env.CONVERSATION_STATE_TTL_MINUTES, 30, 1440),
    exportMaxRows: positiveInteger(env.EXPORT_MAX_ROWS, 10_000, 100_000),
    exportMaxBytes: positiveInteger(env.EXPORT_MAX_BYTES, 8_000_000, 45_000_000)
  };
};
