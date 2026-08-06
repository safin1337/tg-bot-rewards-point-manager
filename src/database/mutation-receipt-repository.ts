import type { MutationReceipt, TransactionType } from "../types/models";
import { mapMutationReceipt } from "./validation";

export interface MutationReceiptValues {
  telegramUpdateId: number;
  customerId: number;
  mutationType: TransactionType;
  pointsDeltaUnits: number;
  balanceBeforeUnits: number;
  balanceAfterUnits: number;
  roundedRewardBeforeBdt: number;
  roundedRewardAfterBdt: number;
  transactionRewardRoundedBdt: number;
  completedAtUtc: string;
}

export interface MutationCompletionExpectation {
  telegramUpdateId: number;
  customerId: number;
  mutationType: TransactionType;
  balanceAfterUnits: number;
  completedAtUtc: string;
  weeklyPeriodKey: string | null;
  monthlyPeriodKey: string | null;
}

export class MutationReceiptRepository {
  constructor(private readonly db: D1Database) {}

  async findCompleted(updateId: number): Promise<MutationReceipt | null> {
    const row = await this.db
      .prepare("SELECT * FROM mutation_receipts WHERE telegram_update_id = ? AND status = 'COMPLETED'")
      .bind(updateId)
      .first();
    return row === null ? null : mapMutationReceipt(row);
  }

  claimStatement(values: MutationReceiptValues): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO mutation_receipts (
           telegram_update_id, customer_id, mutation_type, status, points_delta_units,
           balance_before_units, balance_after_units, rounded_reward_before_bdt,
           rounded_reward_after_bdt, transaction_reward_rounded_bdt, completed_at_utc
         ) VALUES (?, ?, ?, 'PROCESSING', ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        values.telegramUpdateId,
        values.customerId,
        values.mutationType,
        values.pointsDeltaUnits,
        values.balanceBeforeUnits,
        values.balanceAfterUnits,
        values.roundedRewardBeforeBdt,
        values.roundedRewardAfterBdt,
        values.transactionRewardRoundedBdt,
        values.completedAtUtc
      );
  }

  completeStatement(expectation: MutationCompletionExpectation): D1PreparedStatement {
    return this.db
      .prepare(
        `UPDATE mutation_receipts
         SET status = 'COMPLETED'
         WHERE telegram_update_id = ?
           AND status = 'PROCESSING'
           AND customer_id = ?
           AND mutation_type = ?
           AND balance_after_units = ?
           AND EXISTS (
             SELECT 1 FROM customers
             WHERE id = ?
               AND point_balance_units = ?
               AND latest_mutation_telegram_update_id = ?
           )
           AND EXISTS (
             SELECT 1 FROM transactions
             WHERE telegram_update_id = ?
               AND customer_id = ?
               AND transaction_type = ?
               AND balance_after_units = ?
           )
           AND (
             ? IS NULL
             OR EXISTS (
               SELECT 1
               FROM leaderboard_periods AS period
               JOIN leaderboard_aggregates AS aggregate_row
                 ON aggregate_row.period_type = period.period_type
                AND aggregate_row.period_key = period.period_key
                AND aggregate_row.generation = period.current_generation
               WHERE period.period_type = 'WEEK'
                 AND period.period_key = ?
                 AND aggregate_row.customer_id = ?
                 AND aggregate_row.updated_at_utc = ?
             )
           )
           AND (
             ? IS NULL
             OR EXISTS (
               SELECT 1
               FROM leaderboard_periods AS period
               JOIN leaderboard_aggregates AS aggregate_row
                 ON aggregate_row.period_type = period.period_type
                AND aggregate_row.period_key = period.period_key
                AND aggregate_row.generation = period.current_generation
               WHERE period.period_type = 'MONTH'
                 AND period.period_key = ?
                 AND aggregate_row.customer_id = ?
                 AND aggregate_row.updated_at_utc = ?
             )
           )`
      )
      .bind(
        expectation.telegramUpdateId,
        expectation.customerId,
        expectation.mutationType,
        expectation.balanceAfterUnits,
        expectation.customerId,
        expectation.balanceAfterUnits,
        expectation.telegramUpdateId,
        expectation.telegramUpdateId,
        expectation.customerId,
        expectation.mutationType,
        expectation.balanceAfterUnits,
        expectation.weeklyPeriodKey,
        expectation.weeklyPeriodKey,
        expectation.customerId,
        expectation.completedAtUtc,
        expectation.monthlyPeriodKey,
        expectation.monthlyPeriodKey,
        expectation.customerId,
        expectation.completedAtUtc
      );
  }

  pruneCompletedStatement(customerId: number): D1PreparedStatement {
    return this.db
      .prepare(
        `DELETE FROM mutation_receipts
         WHERE customer_id = ?
           AND status = 'COMPLETED'
           AND NOT EXISTS (
             SELECT 1
             FROM transactions AS transaction_row
             WHERE transaction_row.telegram_update_id = mutation_receipts.telegram_update_id
               AND transaction_row.customer_id = mutation_receipts.customer_id
               AND transaction_row.transaction_type = mutation_receipts.mutation_type
           )`
      )
      .bind(customerId);
  }

  retentionGuardStatement(values: MutationReceiptValues): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO mutation_receipts (
           telegram_update_id, customer_id, mutation_type, status, points_delta_units,
           balance_before_units, balance_after_units, rounded_reward_before_bdt,
           rounded_reward_after_bdt, transaction_reward_rounded_bdt, completed_at_utc
         )
         SELECT ?, ?, ?, 'PROCESSING', ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1
           FROM mutation_receipts AS receipt
           JOIN transactions AS transaction_row
             ON transaction_row.telegram_update_id = receipt.telegram_update_id
            AND transaction_row.customer_id = receipt.customer_id
            AND transaction_row.transaction_type = receipt.mutation_type
           WHERE receipt.telegram_update_id = ?
             AND receipt.status = 'COMPLETED'
         )
         OR (SELECT COUNT(*) FROM transactions WHERE customer_id = ?) > 40
         OR (
           SELECT COUNT(*) FROM mutation_receipts
           WHERE customer_id = ? AND status = 'COMPLETED'
         ) > 40
         OR EXISTS (
           SELECT 1
           FROM mutation_receipts AS receipt
           WHERE receipt.customer_id = ?
             AND receipt.status = 'COMPLETED'
             AND NOT EXISTS (
               SELECT 1
               FROM transactions AS transaction_row
               WHERE transaction_row.telegram_update_id = receipt.telegram_update_id
                 AND transaction_row.customer_id = receipt.customer_id
                 AND transaction_row.transaction_type = receipt.mutation_type
             )
         )`
      )
      .bind(
        values.telegramUpdateId,
        values.customerId,
        values.mutationType,
        values.pointsDeltaUnits,
        values.balanceBeforeUnits,
        values.balanceAfterUnits,
        values.roundedRewardBeforeBdt,
        values.roundedRewardAfterBdt,
        values.transactionRewardRoundedBdt,
        values.completedAtUtc,
        values.telegramUpdateId,
        values.customerId,
        values.customerId,
        values.customerId
      );
  }
}
