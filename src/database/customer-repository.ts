import { DomainError } from "../domain/errors";
import type { CustomerIdentifierInput, CustomerIdentifierType } from "../domain/customer-identity";
import { customerIdentifierValue } from "../domain/customer-identity";
import type { NormalizedPhone } from "../domain/phone";
import { validateSearchDigits } from "../domain/phone";
import type { ConversationState, Customer } from "../types/models";
import { mapCustomer } from "./validation";
import { APP_RUNTIME_CONFIG } from "../config/app-config";

export interface CustomerSearchPage { customers: Customer[]; hasNext: boolean; }
export interface IdentifierChangeResult { customer: Customer; changed: boolean; duplicate: boolean; }
export interface TestAccountChangeResult { customer: Customer; changed: boolean; duplicate: boolean; }

const activeStatePredicate = `AND EXISTS (SELECT 1 FROM conversation_states
  WHERE administrator_telegram_id = ? AND operation_started_update_id = ?
    AND updated_at_utc = ? AND expires_at_utc > ?)`;
const activeStateValues = (state: ConversationState, timestamp: string): (number | string)[] => [
  state.administratorTelegramId, state.operationStartedUpdateId, state.updatedAtUtc, timestamp
];

const nextValue = (identifier: CustomerIdentifierInput | null): string | null => {
  if (identifier === null) return null;
  return identifier.type === "WHATSAPP_PHONE" ? identifier.phone.normalized : identifier.username.display;
};

const identifierCount = (customer: Customer): number => [
  customer.whatsappNumber, customer.whatsappUsername, customer.telegramUsername
].filter((value) => value !== null).length;

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

  async findByWhatsappUsername(username: string): Promise<Customer | null> {
    const row = await this.db.prepare(
      "SELECT * FROM customers WHERE whatsapp_username = ? COLLATE NOCASE"
    ).bind(username.toLowerCase()).first();
    return row === null ? null : mapCustomer(row);
  }

  async findByTelegramUsername(username: string): Promise<Customer | null> {
    const row = await this.db.prepare(
      "SELECT * FROM customers WHERE telegram_username = ? COLLATE NOCASE"
    ).bind(username.toLowerCase()).first();
    return row === null ? null : mapCustomer(row);
  }

  async findByIdentifier(identifier: CustomerIdentifierInput): Promise<Customer | null> {
    switch (identifier.type) {
      case "WHATSAPP_PHONE": return this.findByPhone(identifier.phone.normalized);
      case "WHATSAPP_USERNAME": return this.findByWhatsappUsername(identifier.username.lookup);
      case "TELEGRAM_USERNAME": return this.findByTelegramUsername(identifier.username.lookup);
    }
  }

  async findByCreationUpdateId(updateId: number): Promise<Customer | null> {
    const row = await this.db.prepare(
      `SELECT * FROM customers WHERE creation_telegram_update_id = ?
       OR id IN (SELECT target_customer_id FROM customer_merge_receipts
                 WHERE source_creation_update_id = ?)`
    ).bind(updateId, updateId).first();
    return row === null ? null : mapCustomer(row);
  }

  balanceUpdateStatement(
    customerId: number,
    expectedBalanceUnits: number,
    telegramUpdateId: number,
    pointsDeltaUnits: number,
    balanceAfterUnits: number,
    roundedRewardAfterBdt: number,
    updatedAtUtc: string
  ): D1PreparedStatement {
    return this.db.prepare(
      `UPDATE customers SET
         point_balance_units = ?, rounded_reward_bdt = ?, updated_at_utc = ?,
         latest_mutation_telegram_update_id = ?
       WHERE id = ? AND point_balance_units = ? AND point_balance_units + ? >= 0
         AND (latest_mutation_telegram_update_id IS NULL OR latest_mutation_telegram_update_id < ?)`
    ).bind(
      balanceAfterUnits, roundedRewardAfterBdt, updatedAtUtc, telegramUpdateId,
      customerId, expectedBalanceUnits, pointsDeltaUnits, telegramUpdateId
    );
  }

  async createZeroBalance(
    identifier: CustomerIdentifierInput | NormalizedPhone,
    telegramUpdateId: number,
    timestamp: string
  ): Promise<{ customer: Customer; created: boolean }> {
    const normalizedIdentifier: CustomerIdentifierInput = "normalized" in identifier
      ? { type: "WHATSAPP_PHONE", phone: identifier }
      : identifier;
    const existingReplay = await this.findByCreationUpdateId(telegramUpdateId);
    if (existingReplay !== null) return { customer: existingReplay, created: false };

    let statement: D1PreparedStatement;
    switch (normalizedIdentifier.type) {
      case "WHATSAPP_PHONE":
        statement = this.db.prepare(
          `INSERT INTO customers (
             whatsapp_number, phone_last4, phone_last5, point_balance_units,
             rounded_reward_bdt, creation_telegram_update_id, created_at_utc, updated_at_utc
           ) VALUES (?, ?, ?, 0, 0, ?, ?, ?) ON CONFLICT DO NOTHING`
        ).bind(
          normalizedIdentifier.phone.normalized, normalizedIdentifier.phone.last4,
          normalizedIdentifier.phone.last5, telegramUpdateId, timestamp, timestamp
        );
        break;
      case "WHATSAPP_USERNAME":
        statement = this.db.prepare(
          `INSERT INTO customers (
             whatsapp_username, point_balance_units, rounded_reward_bdt,
             creation_telegram_update_id, created_at_utc, updated_at_utc
           ) VALUES (?, 0, 0, ?, ?, ?) ON CONFLICT DO NOTHING`
        ).bind(normalizedIdentifier.username.display, telegramUpdateId, timestamp, timestamp);
        break;
      case "TELEGRAM_USERNAME":
        statement = this.db.prepare(
          `INSERT INTO customers (
             telegram_username, point_balance_units, rounded_reward_bdt,
             creation_telegram_update_id, created_at_utc, updated_at_utc
           ) VALUES (?, 0, 0, ?, ?, ?) ON CONFLICT DO NOTHING`
        ).bind(normalizedIdentifier.username.display, telegramUpdateId, timestamp, timestamp);
        break;
    }

    try {
      const result = await statement.run();
      const customer = await this.findByIdentifier(normalizedIdentifier);
      if (customer !== null) return { customer, created: result.meta.changes === 1 };
      const replay = await this.findByCreationUpdateId(telegramUpdateId);
      if (replay !== null) return { customer: replay, created: false };
      throw new Error("Customer creation did not complete.");
    } catch (error: unknown) {
      const replay = await this.findByCreationUpdateId(telegramUpdateId);
      if (replay !== null) return { customer: replay, created: false };
      throw error;
    }
  }

  async changeIdentifier(
    customerId: number,
    type: CustomerIdentifierType,
    expectedValue: string | null,
    nextIdentifier: CustomerIdentifierInput | null,
    timestamp: string,
    state?: ConversationState
  ): Promise<IdentifierChangeResult> {
    if (nextIdentifier !== null && nextIdentifier.type !== type) {
      throw new Error("Identifier type does not match the requested change.");
    }
    const before = await this.findById(customerId);
    if (before === null) throw new DomainError("IDENTIFIER_STALE", "The selected customer no longer exists.");
    const current = customerIdentifierValue(before, type);
    const requested = nextValue(nextIdentifier);
    if (current !== expectedValue) {
      if (current === requested) return { customer: before, changed: false, duplicate: true };
      throw new DomainError("IDENTIFIER_STALE", "The customer identifier changed. Please review and try again.");
    }
    if (current === requested) return { customer: before, changed: false, duplicate: false };
    if (requested === null && identifierCount(before) <= 1) {
      throw new DomainError("LAST_IDENTIFIER", "A customer's final identifier cannot be removed.");
    }
    if (nextIdentifier !== null) {
      const owner = await this.findByIdentifier(nextIdentifier);
      if (owner !== null && owner.id !== customerId) {
        throw new DomainError("IDENTIFIER_CONFLICT", "That identifier belongs to another customer.");
      }
    }

    const statePredicate = state === undefined ? "" : activeStatePredicate;
    const stateValues = state === undefined ? [] : activeStateValues(state, timestamp);
    let statement: D1PreparedStatement;
    switch (type) {
      case "WHATSAPP_PHONE": {
        const phone = nextIdentifier?.type === "WHATSAPP_PHONE" ? nextIdentifier.phone : null;
        statement = this.db.prepare(
          `UPDATE customers SET whatsapp_number = ?, phone_last4 = ?, phone_last5 = ?, updated_at_utc = ?
           WHERE id = ? AND ((? IS NULL AND whatsapp_number IS NULL)
             OR whatsapp_number = ? COLLATE BINARY) ${statePredicate}`
        ).bind(
          phone?.normalized ?? null, phone?.last4 ?? null, phone?.last5 ?? null,
          timestamp, customerId, expectedValue, expectedValue, ...stateValues
        );
        break;
      }
      case "WHATSAPP_USERNAME":
        statement = this.db.prepare(
          `UPDATE customers SET whatsapp_username = ?, updated_at_utc = ?
           WHERE id = ? AND ((? IS NULL AND whatsapp_username IS NULL)
             OR whatsapp_username = ? COLLATE BINARY) ${statePredicate}`
        ).bind(requested, timestamp, customerId, expectedValue, expectedValue, ...stateValues);
        break;
      case "TELEGRAM_USERNAME":
        statement = this.db.prepare(
          `UPDATE customers SET telegram_username = ?, updated_at_utc = ?
           WHERE id = ? AND ((? IS NULL AND telegram_username IS NULL)
             OR telegram_username = ? COLLATE BINARY) ${statePredicate}`
        ).bind(requested, timestamp, customerId, expectedValue, expectedValue, ...stateValues);
        break;
    }

    try {
      const result = await statement.run();
      const after = await this.findById(customerId);
      if (after === null) throw new DomainError("IDENTIFIER_STALE", "The selected customer no longer exists.");
      if (result.meta.changes === 1) return { customer: after, changed: true, duplicate: false };
      if (customerIdentifierValue(after, type) === requested) {
        return { customer: after, changed: false, duplicate: true };
      }
      throw new DomainError("IDENTIFIER_STALE", "The customer identifier changed. Please review and try again.");
    } catch (error: unknown) {
      if (error instanceof DomainError) throw error;
      if (nextIdentifier !== null) {
        const owner = await this.findByIdentifier(nextIdentifier);
        if (owner !== null && owner.id !== customerId) {
          throw new DomainError("IDENTIFIER_CONFLICT", "That identifier belongs to another customer.");
        }
      }
      throw error;
    }
  }

  async changeTestAccountStatus(
    customerId: number,
    expectedIsTest: boolean,
    nextIsTest: boolean,
    timestamp: string,
    state?: ConversationState
  ): Promise<TestAccountChangeResult> {
    const before = await this.findById(customerId);
    if (before === null) throw new DomainError("IDENTIFIER_STALE", "The selected customer no longer exists.");
    if (before.isTest !== expectedIsTest) {
      if (before.isTest === nextIsTest) {
        return { customer: before, changed: false, duplicate: true };
      }
      throw new DomainError("IDENTIFIER_STALE", "The account type changed. Please review and try again.");
    }
    if (before.isTest === nextIsTest) {
      return { customer: before, changed: false, duplicate: false };
    }
    if (!nextIsTest && before.pointBalanceUnits !== 0) {
      throw new DomainError(
        "TEST_ACCOUNT_BALANCE",
        "A test account must have a zero point balance before conversion to a customer account."
      );
    }

    const statePredicate = state === undefined ? "" : activeStatePredicate;
    const stateValues = state === undefined ? [] : activeStateValues(state, timestamp);
    const statements: D1PreparedStatement[] = [
      this.db.prepare(
        `UPDATE customers SET is_test = ?, updated_at_utc = ?
         WHERE id = ? AND is_test = ?
           AND (? = 1 OR point_balance_units = 0) ${statePredicate}`
      ).bind(nextIsTest ? 1 : 0, timestamp, customerId, expectedIsTest ? 1 : 0, nextIsTest ? 1 : 0, ...stateValues)
    ];
    if (nextIsTest && APP_RUNTIME_CONFIG.analytics.testAccounts.excludeFromLeaderboards) {
      statements.push(
        this.db.prepare(`DELETE FROM leaderboard_aggregates WHERE customer_id = ?
          AND EXISTS (SELECT 1 FROM customers WHERE id = ? AND is_test = 1) ${statePredicate}`)
          .bind(customerId, customerId, ...stateValues)
      );
    }
    const results = await this.db.batch(statements);
    const after = await this.findById(customerId);
    if (after === null) throw new DomainError("IDENTIFIER_STALE", "The selected customer no longer exists.");
    if (results[0]?.meta.changes === 1 && after.isTest === nextIsTest) {
      return { customer: after, changed: true, duplicate: false };
    }
    if (after.isTest === nextIsTest) {
      return { customer: after, changed: false, duplicate: true };
    }
    if (!nextIsTest && after.pointBalanceUnits !== 0) {
      throw new DomainError(
        "TEST_ACCOUNT_BALANCE",
        "A test account must have a zero point balance before conversion to a customer account."
      );
    }
    throw new DomainError("IDENTIFIER_STALE", "The account type changed. Please review and try again.");
  }

  async searchBySuffix(digits: string, page: number): Promise<CustomerSearchPage> {
    validateSearchDigits(digits);
    if (!Number.isSafeInteger(page) || page < 0) throw new Error("Invalid customer search page.");
    const pageSize = 8;
    const column = digits.length === 4 ? "phone_last4" : "phone_last5";
    const result = await this.db.prepare(
      `SELECT * FROM customers WHERE ${column} = ? ORDER BY id ASC LIMIT ? OFFSET ?`
    ).bind(digits, pageSize + 1, page * pageSize).all();
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
