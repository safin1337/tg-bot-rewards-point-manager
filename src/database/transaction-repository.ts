import type { RewardTransaction, TransactionType } from "../types/models";
import { mapTransaction } from "./validation";

export interface TransactionPage {
  transactions: RewardTransaction[];
  hasNext: boolean;
}

export interface ExportTransaction extends RewardTransaction {
  whatsappNumber: string;
}

export class TransactionRepository {
  constructor(private readonly db: D1Database) {}

  async findByUpdateId(updateId: number): Promise<RewardTransaction | null> {
    const row = await this.db
      .prepare("SELECT * FROM transactions WHERE telegram_update_id = ?")
      .bind(updateId)
      .first();
    return row === null ? null : mapTransaction(row);
  }

  insertStatement(values: {
    customerId: number;
    transactionType: TransactionType;
    purchaseAmountBdt: number | null;
    pointsDeltaUnits: number;
    balanceBeforeUnits: number;
    balanceAfterUnits: number;
    roundedRewardBeforeBdt: number;
    roundedRewardAfterBdt: number;
    transactionRewardRoundedBdt: number;
    note: string | null;
    telegramUpdateId: number;
    createdAtUtc: string;
  }): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO transactions (
           customer_id, transaction_type, purchase_amount_bdt, points_delta_units,
           balance_before_units, balance_after_units, rounded_reward_before_bdt,
           rounded_reward_after_bdt, transaction_reward_rounded_bdt, note,
           telegram_update_id, created_at_utc
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE changes() = 1`
      )
      .bind(
        values.customerId,
        values.transactionType,
        values.purchaseAmountBdt,
        values.pointsDeltaUnits,
        values.balanceBeforeUnits,
        values.balanceAfterUnits,
        values.roundedRewardBeforeBdt,
        values.roundedRewardAfterBdt,
        values.transactionRewardRoundedBdt,
        values.note,
        values.telegramUpdateId,
        values.createdAtUtc
      );
  }

  pruneStatement(customerId: number): D1PreparedStatement {
    return this.db
      .prepare(
        `DELETE FROM transactions
         WHERE customer_id = ?
           AND id IN (
             SELECT id FROM transactions
             WHERE customer_id = ?
             ORDER BY created_at_utc DESC, id DESC
             LIMIT -1 OFFSET 40
           )`
      )
      .bind(customerId, customerId);
  }

  async listForCustomer(customerId: number, page: number): Promise<TransactionPage> {
    if (!Number.isSafeInteger(customerId) || customerId <= 0) throw new Error("Invalid customer ID.");
    if (!Number.isSafeInteger(page) || page < 0) throw new Error("Invalid history page.");
    const pageSize = 5;
    const result = await this.db
      .prepare(
        `SELECT * FROM transactions
         WHERE customer_id = ?
         ORDER BY created_at_utc DESC, id DESC
         LIMIT ? OFFSET ?`
      )
      .bind(customerId, pageSize + 1, page * pageSize)
      .all();
    const mapped = result.results.map(mapTransaction);
    return { transactions: mapped.slice(0, pageSize), hasNext: mapped.length > pageSize };
  }

  async countAllUpTo(limit: number): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS count FROM transactions").first<{ count: number }>();
    if (row === null || !Number.isSafeInteger(row.count) || row.count < 0) {
      throw new Error("Invalid transaction count.");
    }
    return Math.min(row.count, limit + 1);
  }

  async listAll(limit: number): Promise<ExportTransaction[]> {
    const result = await this.db
      .prepare(
        `SELECT t.*, c.whatsapp_number
         FROM transactions t
         JOIN customers c ON c.id = t.customer_id
         ORDER BY t.id ASC
         LIMIT ?`
      )
      .bind(limit)
      .all();
    return result.results.map((value: unknown) => {
      const transaction = mapTransaction(value);
      if (typeof value !== "object" || value === null || !("whatsapp_number" in value)) {
        throw new Error("Invalid transaction export row.");
      }
      const phone = value.whatsapp_number;
      if (typeof phone !== "string") throw new Error("Invalid transaction export row.");
      return { ...transaction, whatsappNumber: phone };
    });
  }
}
