import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          BOT_TOKEN: "test-bot-token",
          ADMIN_TELEGRAM_ID: "123456789",
          WEBHOOK_SECRET: "test-webhook-secret",
          CONVERSATION_STATE_TTL_MINUTES: "30",
          EXPORT_MAX_ROWS: "10000",
          EXPORT_MAX_BYTES: "8000000"
        }
      }
    }))
  ],
  test: {
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      reporter: ["text", "html"],
      reportsDirectory: "coverage"
    }
  }
});
