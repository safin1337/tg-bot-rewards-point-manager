import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const timestamp = "2026-08-24T06:00:00.000Z";

const rows = async (db: D1Database, sql: string): Promise<Record<string, unknown>[]> => {
  const result = await db.prepare(sql).all();
  return result.results.map((row) => ({ ...row }));
};

describe("migration 0009 dashboard and test accounts", () => {
  it("preserves V2.0.8 business data, defaults accounts to normal, and starts lifetime totals empty", async () => {
    const migrations: readonly D1Migration[] = env.TEST_MIGRATIONS;
    const migrationIndex = migrations.findIndex(
      (candidate) => candidate.name === "0009_dashboard_and_test_accounts.sql"
    );
    if (migrationIndex < 0) throw new Error("Migration 0009 is missing from the test binding.");
    const migration = migrations.at(migrationIndex);
    if (migration === undefined) throw new Error("Migration 0009 is missing from the test binding.");
    await applyD1Migrations(env.MIGRATION_DB, migrations.slice(0, migrationIndex));

    await env.MIGRATION_DB.batch([
      env.MIGRATION_DB.prepare(
        `INSERT INTO customers (
           id, whatsapp_number, phone_last4, phone_last5, whatsapp_username,
           telegram_username, point_balance_units, rounded_reward_bdt,
           creation_telegram_update_id, latest_mutation_telegram_update_id,
           created_at_utc, updated_at_utc
         ) VALUES (1, '+8801700000001', '0001', '00001', 'Old.Test',
           'Old_Test', 70000, 2, 1001, 2001, ?, ?)`
      ).bind(timestamp, timestamp),
      env.MIGRATION_DB.prepare(
        `INSERT INTO transactions (
           id, customer_id, transaction_type, purchase_amount_bdt, points_delta_units,
           balance_before_units, balance_after_units, rounded_reward_before_bdt,
           rounded_reward_after_bdt, transaction_reward_rounded_bdt, note,
           telegram_update_id, created_at_utc
         ) VALUES (11, 1, 'REDEEM', NULL, -30000, 100000, 70000, 3, 2, 1,
           'pre-release test', 2001, ?)`
      ).bind(timestamp),
      env.MIGRATION_DB.prepare(
        `INSERT INTO mutation_receipts (
           telegram_update_id, customer_id, mutation_type, status, points_delta_units,
           balance_before_units, balance_after_units, rounded_reward_before_bdt,
           rounded_reward_after_bdt, transaction_reward_rounded_bdt, completed_at_utc
         ) VALUES (2001, 1, 'REDEEM', 'COMPLETED', -30000, 100000, 70000,
           3, 2, 1, ?)`
      ).bind(timestamp),
      env.MIGRATION_DB.prepare(
        `INSERT INTO leaderboard_periods (
           period_type, period_key, current_generation, reset_at_utc, updated_at_utc
         ) VALUES ('WEEK', '2026-08-24', 0, NULL, ?)`
      ).bind(timestamp),
      env.MIGRATION_DB.prepare(
        `INSERT INTO leaderboard_aggregates (
           period_type, period_key, generation, customer_id, earned_point_units,
           first_qualifying_earning_at_utc, updated_at_utc
         ) VALUES ('WEEK', '2026-08-24', 0, 1, 100000, ?, ?)`
      ).bind(timestamp, timestamp),
      env.MIGRATION_DB.prepare(
        `INSERT INTO conversation_states (
           administrator_telegram_id, active_operation, current_step, selection_mode,
           selected_customer_id, search_query, search_page, payload_json,
           created_at_utc, updated_at_utc, expires_at_utc, operation_started_update_id
         ) VALUES ('123456789', 'HISTORY', 'SHOW_HISTORY', 'WHATSAPP_USERNAME',
           1, 'Old.Test', 1, '{"token":"abc123"}', ?, ?,
           '2026-08-24T07:00:00.000Z', 1999)`
      ).bind(timestamp, timestamp)
    ]);

    const before = {
      customers: await rows(env.MIGRATION_DB, "SELECT * FROM customers ORDER BY id"),
      transactions: await rows(env.MIGRATION_DB, "SELECT * FROM transactions ORDER BY id"),
      receipts: await rows(env.MIGRATION_DB, "SELECT * FROM mutation_receipts ORDER BY telegram_update_id"),
      periods: await rows(env.MIGRATION_DB, "SELECT * FROM leaderboard_periods ORDER BY period_key"),
      aggregates: await rows(env.MIGRATION_DB, "SELECT * FROM leaderboard_aggregates ORDER BY customer_id"),
      states: await rows(env.MIGRATION_DB, "SELECT * FROM conversation_states ORDER BY administrator_telegram_id")
    };

    await applyD1Migrations(env.MIGRATION_DB, [migration]);

    const migratedCustomer = await env.MIGRATION_DB.prepare(
      "SELECT * FROM customers WHERE id = 1"
    ).first();
    expect(migratedCustomer).toEqual({ ...before.customers[0], is_test: 0 });
    expect(await rows(env.MIGRATION_DB, "SELECT * FROM transactions ORDER BY id"))
      .toEqual(before.transactions);
    expect(await rows(env.MIGRATION_DB, "SELECT * FROM mutation_receipts ORDER BY telegram_update_id"))
      .toEqual(before.receipts);
    expect(await rows(env.MIGRATION_DB, "SELECT * FROM leaderboard_periods ORDER BY period_key"))
      .toEqual(before.periods);
    expect(await rows(env.MIGRATION_DB, "SELECT * FROM leaderboard_aggregates ORDER BY customer_id"))
      .toEqual(before.aggregates);
    expect(await rows(env.MIGRATION_DB, "SELECT * FROM conversation_states ORDER BY administrator_telegram_id"))
      .toEqual(before.states);
    expect(await env.MIGRATION_DB.prepare(
      "SELECT COUNT(*) AS count FROM lifetime_redemption_snapshots"
    ).first("count")).toBe(0);
    expect((await env.MIGRATION_DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);

    await env.MIGRATION_DB.prepare(
      `UPDATE conversation_states
       SET active_operation = 'MANAGE_TEST_ACCOUNT', current_step = 'MANAGE_TEST_ACCOUNT'
       WHERE administrator_telegram_id = '123456789'`
    ).run();
    expect(await env.MIGRATION_DB.prepare(
      "SELECT active_operation FROM conversation_states WHERE administrator_telegram_id = '123456789'"
    ).first("active_operation")).toBe("MANAGE_TEST_ACCOUNT");
    await expect(env.MIGRATION_DB.prepare(
      "UPDATE customers SET is_test = 2 WHERE id = 1"
    ).run()).rejects.toThrow();
  });
});
