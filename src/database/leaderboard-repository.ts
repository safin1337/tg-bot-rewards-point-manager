import {
  leaderboardPeriodKey,
  leaderboardPeriods,
  retainedLeaderboardKeys,
  type LeaderboardPeriod
} from "../domain/leaderboard";
import type { LeaderboardEntry, LeaderboardPeriodType } from "../types/models";
import { subtractUtcCalendarMonthsClamped } from "../utils/time";
import { mapLeaderboardEntry } from "./validation";

export interface LeaderboardResetResult {
  duplicate: boolean;
  period: LeaderboardPeriod;
  resetAtUtc: string;
}

const validUpdateId = (value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid Telegram update ID.");
};

export class LeaderboardRepository {
  constructor(
    private readonly db: D1Database,
    private readonly clock: () => Date = () => new Date()
  ) {}

  earningStatements(
    customerId: number,
    earnedPointUnits: number,
    recordedAtUtc: string
  ): D1PreparedStatement[] {
    const at = new Date(recordedAtUtc);
    const weekKey = leaderboardPeriodKey("WEEK", at);
    const monthKey = leaderboardPeriodKey("MONTH", at);
    const pairs: readonly [LeaderboardPeriodType, string][] = [
      ["WEEK", weekKey],
      ["MONTH", monthKey]
    ];
    const statements: D1PreparedStatement[] = [];
    for (const [type, key] of pairs) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO leaderboard_periods (
               period_type, period_key, current_generation, reset_at_utc, updated_at_utc
             ) VALUES (?, ?, 0, NULL, ?)
             ON CONFLICT(period_type, period_key) DO NOTHING`
          )
          .bind(type, key, recordedAtUtc),
        this.db
          .prepare(
            `INSERT INTO leaderboard_aggregates (
               period_type, period_key, generation, customer_id, earned_point_units,
               first_qualifying_earning_at_utc, updated_at_utc
             ) VALUES (
               ?, ?,
               (SELECT current_generation FROM leaderboard_periods
                WHERE period_type = ? AND period_key = ?),
               ?, ?, ?, ?
             )
             ON CONFLICT(period_type, period_key, generation, customer_id) DO UPDATE SET
               earned_point_units = leaderboard_aggregates.earned_point_units + excluded.earned_point_units,
               first_qualifying_earning_at_utc = MIN(
                 leaderboard_aggregates.first_qualifying_earning_at_utc,
                 excluded.first_qualifying_earning_at_utc
               ),
               updated_at_utc = excluded.updated_at_utc`
          )
          .bind(
            type,
            key,
            type,
            key,
            customerId,
            earnedPointUnits,
            recordedAtUtc,
            recordedAtUtc
          )
      );
    }
    return statements;
  }

  retentionStatement(at: Date): D1PreparedStatement {
    const retained = retainedLeaderboardKeys(at);
    return this.db
      .prepare(
        `DELETE FROM leaderboard_periods
         WHERE (period_type = 'WEEK' AND period_key NOT IN (?, ?, ?))
            OR (period_type = 'MONTH' AND period_key NOT IN (?, ?))`
      )
      .bind(...retained.weeks, ...retained.months);
  }

  resetReceiptRetentionStatement(at: Date): D1PreparedStatement {
    const cutoffUtc = subtractUtcCalendarMonthsClamped(at, 2).toISOString();
    return this.db
      .prepare(
        `DELETE FROM leaderboard_reset_receipts
         WHERE telegram_update_id NOT IN (
           SELECT telegram_update_id
           FROM leaderboard_reset_receipts
           WHERE reset_at_utc >= ?
           ORDER BY reset_at_utc DESC, telegram_update_id DESC
           LIMIT 40
         )`
      )
      .bind(cutoffUtc);
  }

  private resetReceiptRetentionGuardStatement(
    updateId: number,
    type: LeaderboardPeriodType,
    periodKey: string,
    resetAtUtc: string,
    administratorTelegramId: string,
    at: Date
  ): D1PreparedStatement {
    const cutoffUtc = subtractUtcCalendarMonthsClamped(at, 2).toISOString();
    return this.db
      .prepare(
        `INSERT INTO leaderboard_reset_receipts (
           telegram_update_id, period_type, period_key, generation, status,
           reset_at_utc, administrator_telegram_id
         )
         SELECT ?, ?, ?, 0, 'PROCESSING', ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM leaderboard_reset_receipts
           WHERE telegram_update_id = ? AND status = 'COMPLETED'
         )
         OR EXISTS (
           SELECT 1 FROM leaderboard_reset_receipts WHERE reset_at_utc < ?
         )
         OR (SELECT COUNT(*) FROM leaderboard_reset_receipts) > 40`
      )
      .bind(
        updateId,
        type,
        periodKey,
        resetAtUtc,
        administratorTelegramId,
        updateId,
        cutoffUtc
      );
  }

  async cleanupResetReceipts(): Promise<void> {
    await this.resetReceiptRetentionStatement(this.clock()).run();
  }

  async list(period: LeaderboardPeriod): Promise<LeaderboardEntry[]> {
    const allowed = leaderboardPeriods(period.type, this.clock())
      .some((candidate) => candidate.key === period.key);
    if (!allowed) throw new Error("Leaderboard period is outside the retained window.");
    const result = await this.db
      .prepare(
        `SELECT
           aggregate_row.customer_id,
           customer.whatsapp_number,
           customer.whatsapp_username,
           customer.telegram_username,
           aggregate_row.earned_point_units,
           aggregate_row.first_qualifying_earning_at_utc
         FROM leaderboard_periods AS period
         JOIN leaderboard_aggregates AS aggregate_row
           ON aggregate_row.period_type = period.period_type
          AND aggregate_row.period_key = period.period_key
          AND aggregate_row.generation = period.current_generation
         JOIN customers AS customer ON customer.id = aggregate_row.customer_id
         WHERE period.period_type = ? AND period.period_key = ?
         ORDER BY
           aggregate_row.earned_point_units DESC,
           aggregate_row.first_qualifying_earning_at_utc ASC,
           aggregate_row.customer_id ASC
         LIMIT 10`
      )
      .bind(period.type, period.key)
      .all();
    return result.results.map(mapLeaderboardEntry);
  }

  private async completedReset(updateId: number): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT status FROM leaderboard_reset_receipts
         WHERE telegram_update_id = ?`
      )
      .bind(updateId)
      .first<{ status: unknown }>();
    if (row === null) return false;
    if (row.status !== "COMPLETED") throw new Error("Invalid leaderboard reset receipt.");
    return true;
  }

  async resetCurrent(
    type: LeaderboardPeriodType,
    expectedPeriodKey: string,
    updateId: number,
    administratorTelegramId: string
  ): Promise<LeaderboardResetResult> {
    validUpdateId(updateId);
    if (!/^[1-9]\d*$/.test(administratorTelegramId)) throw new Error("Invalid administrator ID.");
    const at = this.clock();
    const resetAtUtc = at.toISOString();
    const period = leaderboardPeriods(type, at)[0];
    if (period === undefined) throw new Error("Current leaderboard period is unavailable.");
    if (period.key !== expectedPeriodKey) throw new Error("The leaderboard period changed before confirmation.");
    if (await this.completedReset(updateId)) return { duplicate: true, period, resetAtUtc };

    const statements = [
      this.db
        .prepare(
          `INSERT INTO leaderboard_reset_receipts (
             telegram_update_id, period_type, period_key, generation, status,
             reset_at_utc, administrator_telegram_id
           ) VALUES (?, ?, ?, 0, 'PROCESSING', ?, ?)`
        )
        .bind(updateId, type, period.key, resetAtUtc, administratorTelegramId),
      this.db
        .prepare(
          `INSERT INTO leaderboard_periods (
             period_type, period_key, current_generation, reset_at_utc, updated_at_utc
           ) VALUES (?, ?, 0, NULL, ?)
           ON CONFLICT(period_type, period_key) DO NOTHING`
        )
        .bind(type, period.key, resetAtUtc),
      this.db
        .prepare(
          `UPDATE leaderboard_periods
           SET current_generation = current_generation + 1,
               reset_at_utc = ?,
               updated_at_utc = ?
           WHERE period_type = ? AND period_key = ?`
        )
        .bind(resetAtUtc, resetAtUtc, type, period.key),
      this.db
        .prepare(
          `DELETE FROM leaderboard_aggregates
           WHERE period_type = ?
             AND period_key = ?
             AND generation < (
               SELECT current_generation FROM leaderboard_periods
               WHERE period_type = ? AND period_key = ?
             )`
        )
        .bind(type, period.key, type, period.key),
      this.db
        .prepare(
          `UPDATE leaderboard_reset_receipts
           SET generation = (
                 SELECT current_generation FROM leaderboard_periods
                 WHERE period_type = ? AND period_key = ?
               ),
               status = 'COMPLETED'
           WHERE telegram_update_id = ? AND status = 'PROCESSING'`
        )
        .bind(type, period.key, updateId),
      this.retentionStatement(at),
      this.resetReceiptRetentionStatement(at),
      this.resetReceiptRetentionGuardStatement(
        updateId,
        type,
        period.key,
        resetAtUtc,
        administratorTelegramId,
        at
      ),
      this.db
        .prepare(
          `INSERT INTO leaderboard_reset_receipts (
             telegram_update_id, period_type, period_key, generation, status,
             reset_at_utc, administrator_telegram_id
           )
           SELECT ?, ?, ?, 0, 'PROCESSING', ?, ?
           WHERE NOT EXISTS (
             SELECT 1
             FROM leaderboard_reset_receipts AS receipt
             JOIN leaderboard_periods AS period
               ON period.period_type = receipt.period_type
              AND period.period_key = receipt.period_key
              AND period.current_generation = receipt.generation
             WHERE receipt.telegram_update_id = ?
               AND receipt.status = 'COMPLETED'
               AND receipt.period_type = ?
               AND receipt.period_key = ?
               AND period.reset_at_utc = receipt.reset_at_utc
           )`
        )
        .bind(
          updateId,
          type,
          period.key,
          resetAtUtc,
          administratorTelegramId,
          updateId,
          type,
          period.key
        )
    ];

    try {
      const results = await this.db.batch(statements);
      if (
        results[0]?.meta.changes !== 1
        || results[2]?.meta.changes !== 1
        || results[4]?.meta.changes !== 1
      ) {
        throw new Error("Leaderboard reset did not complete atomically.");
      }
      return { duplicate: false, period, resetAtUtc };
    } catch (error: unknown) {
      if (await this.completedReset(updateId)) return { duplicate: true, period, resetAtUtc };
      throw error;
    }
  }
}
