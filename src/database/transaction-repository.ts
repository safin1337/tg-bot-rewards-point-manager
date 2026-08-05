import type { RewardTransaction } from "../types/models";
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
