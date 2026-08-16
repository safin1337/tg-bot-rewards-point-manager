import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const timestamp = "2026-08-16T06:00:00.000Z";

const rows = async (db: D1Database, sql: string): Promise<Record<string, unknown>[]> => {
  const result = await db.prepare(sql).all();
  return result.results.map((row) => ({ ...row }));
};

describe("migration 0008 WhatsApp username periods", () => {
  it("preserves representative V2.0.6 data and changes only platform-appropriate constraints", async () => {
    const migrations: readonly D1Migration[] = env.TEST_MIGRATIONS;
    const migrationIndex = migrations.findIndex(
      (candidate) => candidate.name === "0008_allow_whatsapp_username_period.sql"
    );
    if (migrationIndex < 0) throw new Error("Migration 0008 is missing from the test binding.");
    const migration = migrations.at(migrationIndex);
    if (migration === undefined) throw new Error("Migration 0008 is missing from the test binding.");
    const preMigration = migrations.slice(0, migrationIndex);
    await applyD1Migrations(env.MIGRATION_DB, preMigration);

    const customerFixtures = [
      [1, "+8801700000001", "0001", "00001", null, null, 0, 0, 1001, null],
      [2, null, null, null, "WhatsappOnly", null, 10_000, 0, 1002, null],
      [3, null, null, null, null, "TelegramOnly", 20_000, 1, 1003, null],
      [4, "+8801700000004", "0004", "00004", "PhoneWhatsapp", null, 30_000, 1, 1004, null],
      [5, "+8801700000005", "0005", "00005", null, "PhoneTelegram", 40_000, 1, 1005, null],
      [6, null, null, null, "SameAcrossPlatforms", "SameAcrossPlatforms", 45_000, 1, 1006, null],
      [7, "+8801700000007", "0007", "00007", "AllWhatsapp", "AllTelegram", 50_000, 1, 1007, 3001]
    ] as const;
    const customerStatement = env.MIGRATION_DB.prepare(
      `INSERT INTO customers (
         id, whatsapp_number, phone_last4, phone_last5,
         whatsapp_username, telegram_username,
         point_balance_units, rounded_reward_bdt,
         creation_telegram_update_id, latest_mutation_telegram_update_id,
         created_at_utc, updated_at_utc
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    await env.MIGRATION_DB.batch(customerFixtures.map((fixture) =>
      customerStatement.bind(...fixture, timestamp, timestamp)
    ));
    await env.MIGRATION_DB.batch([
      env.MIGRATION_DB.prepare(
        `INSERT INTO transactions (
           id, customer_id, transaction_type, purchase_amount_bdt, points_delta_units,
           balance_before_units, balance_after_units, rounded_reward_before_bdt,
           rounded_reward_after_bdt, transaction_reward_rounded_bdt, note,
           telegram_update_id, created_at_utc
         ) VALUES (51, 7, 'MANUAL_ADD', NULL, 50000, 0, 50000, 0, 1, 1, 'fixture', 3001, ?)`
      ).bind(timestamp),
      env.MIGRATION_DB.prepare(
        `INSERT INTO mutation_receipts (
           telegram_update_id, customer_id, mutation_type, status, points_delta_units,
           balance_before_units, balance_after_units, rounded_reward_before_bdt,
           rounded_reward_after_bdt, transaction_reward_rounded_bdt, completed_at_utc
         ) VALUES (3001, 7, 'MANUAL_ADD', 'COMPLETED', 50000, 0, 50000, 0, 1, 1, ?)`
      ).bind(timestamp),
      env.MIGRATION_DB.prepare(
        `INSERT INTO leaderboard_periods (
           period_type, period_key, current_generation, reset_at_utc, updated_at_utc
         ) VALUES ('WEEK', '2026-08-10', 1, ?, ?)`
      ).bind(timestamp, timestamp),
      env.MIGRATION_DB.prepare(
        `INSERT INTO leaderboard_aggregates (
           period_type, period_key, generation, customer_id, earned_point_units,
           first_qualifying_earning_at_utc, updated_at_utc
         ) VALUES ('WEEK', '2026-08-10', 1, 7, 50000, ?, ?)`
      ).bind(timestamp, timestamp),
      env.MIGRATION_DB.prepare(
        `INSERT INTO leaderboard_reset_receipts (
           telegram_update_id, period_type, period_key, generation, status,
           reset_at_utc, administrator_telegram_id
         ) VALUES (3002, 'WEEK', '2026-08-10', 1, 'COMPLETED', ?, '123456789')`
      ).bind(timestamp),
      env.MIGRATION_DB.prepare(
        `INSERT INTO conversation_states (
           administrator_telegram_id, active_operation, current_step, selection_mode,
           selected_customer_id, search_query, search_page, payload_json,
           created_at_utc, updated_at_utc, expires_at_utc, operation_started_update_id
         ) VALUES (
           '123456789', 'HISTORY', 'SHOW_HISTORY', 'WHATSAPP_USERNAME',
           7, 'AllWhatsapp', 2, '{"token":"abc123"}', ?, ?,
           '2026-08-16T07:00:00.000Z', 2999
         )`
      ).bind(timestamp, timestamp),
      env.MIGRATION_DB.prepare(
        `INSERT INTO processed_updates (
           telegram_update_id, update_type, status, processed_at_utc, export_progress
         ) VALUES (3003, 'EXPORT', 'COMPLETED', ?, 'BOTH_SENT')`
      ).bind(timestamp)
    ]);

    const snapshots = {
      customers: await rows(env.MIGRATION_DB, "SELECT * FROM customers ORDER BY id"),
      transactions: await rows(env.MIGRATION_DB, "SELECT * FROM transactions ORDER BY id"),
      receipts: await rows(env.MIGRATION_DB, "SELECT * FROM mutation_receipts ORDER BY telegram_update_id"),
      periods: await rows(env.MIGRATION_DB, "SELECT * FROM leaderboard_periods ORDER BY period_type, period_key"),
      aggregates: await rows(env.MIGRATION_DB, "SELECT * FROM leaderboard_aggregates ORDER BY customer_id"),
      resets: await rows(env.MIGRATION_DB, "SELECT * FROM leaderboard_reset_receipts ORDER BY telegram_update_id"),
      states: await rows(env.MIGRATION_DB, "SELECT * FROM conversation_states ORDER BY administrator_telegram_id"),
      updates: await rows(env.MIGRATION_DB, "SELECT * FROM processed_updates ORDER BY telegram_update_id")
    };

    await applyD1Migrations(env.MIGRATION_DB, [migration]);

    expect(await rows(env.MIGRATION_DB, "SELECT * FROM customers WHERE id <= 7 ORDER BY id"))
      .toEqual(snapshots.customers);
    expect(await rows(env.MIGRATION_DB, "SELECT * FROM transactions ORDER BY id"))
      .toEqual(snapshots.transactions);
    expect(await rows(env.MIGRATION_DB, "SELECT * FROM mutation_receipts ORDER BY telegram_update_id"))
      .toEqual(snapshots.receipts);
    expect(await rows(env.MIGRATION_DB, "SELECT * FROM leaderboard_periods ORDER BY period_type, period_key"))
      .toEqual(snapshots.periods);
    expect(await rows(env.MIGRATION_DB, "SELECT * FROM leaderboard_aggregates ORDER BY customer_id"))
      .toEqual(snapshots.aggregates);
    expect(await rows(env.MIGRATION_DB, "SELECT * FROM leaderboard_reset_receipts ORDER BY telegram_update_id"))
      .toEqual(snapshots.resets);
    expect(await rows(env.MIGRATION_DB, "SELECT * FROM conversation_states ORDER BY administrator_telegram_id"))
      .toEqual(snapshots.states);
    expect(await rows(env.MIGRATION_DB, "SELECT * FROM processed_updates ORDER BY telegram_update_id"))
      .toEqual(snapshots.updates);
    expect((await env.MIGRATION_DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    expect(await env.MIGRATION_DB.prepare(
      "SELECT id FROM customers WHERE whatsapp_username = ? COLLATE NOCASE"
    ).bind("allwhatsapp").first("id")).toBe(7);

    await env.MIGRATION_DB.prepare(
      `INSERT INTO customers (
         id, whatsapp_username, point_balance_units, rounded_reward_bdt,
         creation_telegram_update_id, created_at_utc, updated_at_utc
       ) VALUES (20, 'Period.Name', 0, 0, 1020, ?, ?)`
    ).bind(timestamp, timestamp).run();
    await env.MIGRATION_DB.prepare(
      `INSERT INTO customers (
         id, whatsapp_username, point_balance_units, rounded_reward_bdt,
         creation_telegram_update_id, created_at_utc, updated_at_utc
       ) VALUES (21, 'PeriodName', 0, 0, 1021, ?, ?)`
    ).bind(timestamp, timestamp).run();
    expect(await env.MIGRATION_DB.prepare(
      "SELECT id FROM customers WHERE whatsapp_username = ? COLLATE NOCASE"
    ).bind("period.name").first("id")).toBe(20);

    for (const [id, username] of [[22, ".leading"], [23, "trailing."], [24, "two..periods"]] as const) {
      await expect(env.MIGRATION_DB.prepare(
        `INSERT INTO customers (
           id, whatsapp_username, point_balance_units, rounded_reward_bdt,
           creation_telegram_update_id, created_at_utc, updated_at_utc
         ) VALUES (?, ?, 0, 0, ?, ?, ?)`
      ).bind(id, username, 1000 + id, timestamp, timestamp).run()).rejects.toThrow();
    }
    await expect(env.MIGRATION_DB.prepare(
      `INSERT INTO customers (
         id, telegram_username, point_balance_units, rounded_reward_bdt,
         creation_telegram_update_id, created_at_utc, updated_at_utc
       ) VALUES (25, 'Telegram.Period', 0, 0, 1025, ?, ?)`
    ).bind(timestamp, timestamp).run()).rejects.toThrow();
    await expect(env.MIGRATION_DB.prepare(
      `INSERT INTO customers (
         id, whatsapp_username, point_balance_units, rounded_reward_bdt,
         creation_telegram_update_id, created_at_utc, updated_at_utc
       ) VALUES (26, 'period.name', 0, 0, 1026, ?, ?)`
    ).bind(timestamp, timestamp).run()).rejects.toThrow();

    await env.MIGRATION_DB.prepare(
      `INSERT INTO customers (
         id, whatsapp_username, point_balance_units, rounded_reward_bdt,
         creation_telegram_update_id, created_at_utc, updated_at_utc
       ) VALUES (30, 'Cross_Name', 0, 0, 1030, ?, ?)`
    ).bind(timestamp, timestamp).run();
    await env.MIGRATION_DB.prepare(
      `INSERT INTO customers (
         id, telegram_username, point_balance_units, rounded_reward_bdt,
         creation_telegram_update_id, created_at_utc, updated_at_utc
       ) VALUES (31, 'cross_name', 0, 0, 1031, ?, ?)`
    ).bind(timestamp, timestamp).run();
    expect(await env.MIGRATION_DB.prepare(
      "SELECT COUNT(*) AS count FROM customers WHERE id IN (30, 31)"
    ).first("count")).toBe(2);
  });
});
