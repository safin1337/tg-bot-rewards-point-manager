import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { IdempotencyRepository } from "../src/database/idempotency-repository";
import { LeaderboardRepository } from "../src/database/leaderboard-repository";
import { subtractUtcCalendarMonthsClamped } from "../src/utils/time";

const ADMIN_ID = "123456789";
const NOW = new Date("2026-08-31T12:34:56.789Z");

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM processed_updates"),
    env.DB.prepare("DELETE FROM conversation_states"),
    env.DB.prepare("DELETE FROM leaderboard_reset_receipts"),
    env.DB.prepare("DELETE FROM leaderboard_aggregates"),
    env.DB.prepare("DELETE FROM leaderboard_periods"),
    env.DB.prepare("DELETE FROM transactions"),
    env.DB.prepare("DELETE FROM mutation_receipts"),
    env.DB.prepare("DELETE FROM customers")
  ]);
});

const insertResetReceipt = async (updateId: number, resetAtUtc: string): Promise<void> => {
  await env.DB.prepare(
    `INSERT INTO leaderboard_reset_receipts (
       telegram_update_id, period_type, period_key, generation, status,
       reset_at_utc, administrator_telegram_id
     ) VALUES (?, 'WEEK', '2026-08-31', 1, 'COMPLETED', ?, ?)`
  ).bind(updateId, resetAtUtc, ADMIN_ID).run();
};

const insertProcessed = async (
  updateId: number,
  status: "PROCESSING" | "COMPLETED" | "FAILED",
  processedAtUtc: string,
  progress = "NONE"
): Promise<void> => {
  await env.DB.prepare(
    `INSERT INTO processed_updates (
       telegram_update_id, update_type, status, processed_at_utc, export_progress
     ) VALUES (?, 'EXPORT', ?, ?, ?)`
  ).bind(updateId, status, processedAtUtc, progress).run();
};

const count = async (table: "leaderboard_reset_receipts" | "processed_updates"): Promise<number> => {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .first<{ count: number }>();
  if (row === null || !Number.isSafeInteger(row.count)) throw new Error("Invalid test count.");
  return row.count;
};

describe("two-calendar-month cutoff", () => {
  it.each([
    ["2026-08-31T12:34:56.789Z", "2026-06-30T12:34:56.789Z"],
    ["2026-03-31T00:00:00.000Z", "2026-01-31T00:00:00.000Z"],
    ["2026-04-30T00:00:00.000Z", "2026-02-28T00:00:00.000Z"],
    ["2024-04-30T00:00:00.000Z", "2024-02-29T00:00:00.000Z"]
  ])("clamps %s to %s", (input, expected) => {
    expect(subtractUtcCalendarMonthsClamped(new Date(input), 2).toISOString()).toBe(expected);
  });
});

describe("leaderboard reset receipt retention", () => {
  it("enforces the 39, 40, and 41 row boundaries with a stable update-ID tie-breaker", async () => {
    const repository = new LeaderboardRepository(env.DB, () => NOW);
    for (let updateId = 1; updateId <= 39; updateId += 1) {
      await insertResetReceipt(updateId, NOW.toISOString());
    }
    await repository.cleanupResetReceipts();
    expect(await count("leaderboard_reset_receipts")).toBe(39);

    await insertResetReceipt(40, NOW.toISOString());
    await repository.cleanupResetReceipts();
    expect(await count("leaderboard_reset_receipts")).toBe(40);

    await insertResetReceipt(41, NOW.toISOString());
    await repository.cleanupResetReceipts();
    expect(await count("leaderboard_reset_receipts")).toBe(40);
    const rows = await env.DB.prepare(
      "SELECT telegram_update_id FROM leaderboard_reset_receipts ORDER BY telegram_update_id"
    ).all<{ telegram_update_id: number }>();
    expect(rows.results.map((row) => row.telegram_update_id)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 2)
    );
  });

  it("deletes immediately before the cutoff and retains exactly at and after it", async () => {
    const cutoff = subtractUtcCalendarMonthsClamped(NOW, 2);
    await insertResetReceipt(100, new Date(cutoff.getTime() - 1).toISOString());
    await insertResetReceipt(101, cutoff.toISOString());
    await insertResetReceipt(102, new Date(cutoff.getTime() + 1).toISOString());
    await new LeaderboardRepository(env.DB, () => NOW).cleanupResetReceipts();
    const rows = await env.DB.prepare(
      "SELECT telegram_update_id FROM leaderboard_reset_receipts ORDER BY telegram_update_id"
    ).all<{ telegram_update_id: number }>();
    expect(rows.results).toEqual([{ telegram_update_id: 101 }, { telegram_update_id: 102 }]);
  });
});

describe("processed Telegram update retention", () => {
  it("enforces the 39, 40, and 41 eligible-row boundaries deterministically", async () => {
    const repository = new IdempotencyRepository(env.DB, () => NOW);
    for (let updateId = 1; updateId <= 39; updateId += 1) {
      await insertProcessed(updateId, updateId % 2 === 0 ? "COMPLETED" : "FAILED", NOW.toISOString());
    }
    await repository.cleanup();
    expect(await count("processed_updates")).toBe(39);
    await insertProcessed(40, "COMPLETED", NOW.toISOString());
    await repository.cleanup();
    expect(await count("processed_updates")).toBe(40);
    await insertProcessed(41, "FAILED", NOW.toISOString());
    await repository.cleanup();
    expect(await count("processed_updates")).toBe(40);
    const rows = await env.DB.prepare(
      "SELECT telegram_update_id FROM processed_updates ORDER BY telegram_update_id"
    ).all<{ telegram_update_id: number }>();
    expect(rows.results.map((row) => row.telegram_update_id)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 2)
    );
  });

  it("preserves a genuinely active lease while deleting stale, completed, and failed old work", async () => {
    const old = "2026-06-01T00:00:00.000Z";
    await insertProcessed(200, "PROCESSING", new Date(NOW.getTime() - 4 * 60_000).toISOString());
    await insertProcessed(204, "PROCESSING", new Date(NOW.getTime() - 5 * 60_000).toISOString());
    await insertProcessed(201, "PROCESSING", old, "CUSTOMERS_SENT");
    await insertProcessed(202, "COMPLETED", old);
    await insertProcessed(203, "FAILED", old, "CUSTOMERS_SENT");
    await new IdempotencyRepository(env.DB, () => NOW).cleanup();
    const rows = await env.DB.prepare(
      "SELECT telegram_update_id FROM processed_updates ORDER BY telegram_update_id"
    ).all<{ telegram_update_id: number }>();
    expect(rows.results).toEqual([{ telegram_update_id: 200 }, { telegram_update_id: 204 }]);
  });

  it("retains eligible work exactly at and after the cutoff but not immediately before it", async () => {
    const cutoff = subtractUtcCalendarMonthsClamped(NOW, 2);
    await insertProcessed(300, "FAILED", new Date(cutoff.getTime() - 1).toISOString());
    await insertProcessed(301, "FAILED", cutoff.toISOString());
    await insertProcessed(302, "COMPLETED", new Date(cutoff.getTime() + 1).toISOString());
    await new IdempotencyRepository(env.DB, () => NOW).cleanup();
    const rows = await env.DB.prepare(
      "SELECT telegram_update_id FROM processed_updates ORDER BY telegram_update_id"
    ).all<{ telegram_update_id: number }>();
    expect(rows.results).toEqual([{ telegram_update_id: 301 }, { telegram_update_id: 302 }]);
  });
});
