import type { NormalizedPhone } from "../domain/phone";
import { validateSearchDigits } from "../domain/phone";
import type { Customer } from "../types/models";
import { mapCustomer } from "./validation";

export interface CustomerSearchPage {
  customers: Customer[];
  hasNext: boolean;
}

export class CustomerRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: number): Promise<Customer | null> {
    const row = await this.db.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first();
    return row === null ? null : mapCustomer(row);
  }

  async findByPhone(phone: string): Promise<Customer | null> {
    const row = await this.db.prepare("SELECT * FROM customers WHERE whatsapp_number = ?").bind(phone).first();
    return row === null ? null : mapCustomer(row);
  }

  async findByCreationUpdateId(updateId: number): Promise<Customer | null> {
    const row = await this.db
      .prepare("SELECT * FROM customers WHERE creation_telegram_update_id = ?")
      .bind(updateId)
      .first();
    return row === null ? null : mapCustomer(row);
  }

  async createZeroBalance(
    phone: NormalizedPhone,
    telegramUpdateId: number,
    timestamp: string
  ): Promise<{ customer: Customer; created: boolean }> {
    try {
      const result = await this.db
        .prepare(
          `INSERT INTO customers (
             whatsapp_number, phone_last4, phone_last5, point_balance_units,
             rounded_reward_bdt, creation_telegram_update_id, created_at_utc, updated_at_utc
           ) VALUES (?, ?, ?, 0, 0, ?, ?, ?)
           ON CONFLICT(whatsapp_number) DO NOTHING`
        )
        .bind(phone.normalized, phone.last4, phone.last5, telegramUpdateId, timestamp, timestamp)
        .run();
      const customer = await this.findByPhone(phone.normalized);
      if (customer === null) {
        const duplicate = await this.findByCreationUpdateId(telegramUpdateId);
        if (duplicate !== null) return { customer: duplicate, created: false };
        throw new Error("Customer creation did not complete.");
      }
      return { customer, created: result.meta.changes === 1 };
    } catch (error: unknown) {
      const duplicate = await this.findByCreationUpdateId(telegramUpdateId);
      if (duplicate !== null) return { customer: duplicate, created: false };
      throw error;
    }
  }

  async searchBySuffix(digits: string, page: number): Promise<CustomerSearchPage> {
    validateSearchDigits(digits);
    if (!Number.isSafeInteger(page) || page < 0) throw new Error("Invalid customer search page.");
    const pageSize = 8;
    const column = digits.length === 4 ? "phone_last4" : "phone_last5";
    const offset = page * pageSize;
    const result = await this.db
      .prepare(`SELECT * FROM customers WHERE ${column} = ? ORDER BY id ASC LIMIT ? OFFSET ?`)
      .bind(digits, pageSize + 1, offset)
      .all();
    const mapped = result.results.map(mapCustomer);
    return { customers: mapped.slice(0, pageSize), hasNext: mapped.length > pageSize };
  }

  async countAllUpTo(limit: number): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS count FROM customers").first<{ count: number }>();
    if (row === null || !Number.isSafeInteger(row.count) || row.count < 0) {
      throw new Error("Invalid customer count.");
    }
    return Math.min(row.count, limit + 1);
  }

  async listAll(limit: number): Promise<Customer[]> {
    const result = await this.db.prepare("SELECT * FROM customers ORDER BY id ASC LIMIT ?").bind(limit).all();
    return result.results.map(mapCustomer);
  }
}
