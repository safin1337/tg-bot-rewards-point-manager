import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { RewardMutationService } from "../src/application/mutation-service";
import { CustomerRepository } from "../src/database/customer-repository";
import { IdempotencyRepository } from "../src/database/idempotency-repository";
import { StateRepository, newStateToken } from "../src/database/state-repository";
import { TransactionRepository } from "../src/database/transaction-repository";
import { normalizePhone } from "../src/domain/phone";
import { purchaseToPointUnits } from "../src/domain/rewards";

const customers = () => new CustomerRepository(env.DB);
const transactions = () => new TransactionRepository(env.DB);

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

describe("clean migration", () => {
  it("creates all required tables", async () => {
    const rows = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).all<{ name: string }>();
    const names = rows.results.map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining([
      "customers", "transactions", "conversation_states", "processed_updates",
      "mutation_receipts", "leaderboard_periods", "leaderboard_aggregates",
      "leaderboard_reset_receipts"
    ]));
  });

  it("adds persisted export delivery progress for resumable complete exports", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(processed_updates)").all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).toContain("export_progress");
  });

  it("adds the workflow update-order boundary used to reject delayed updates", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(conversation_states)").all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).toContain("operation_started_update_id");
  });

  it("adds bounded-retention indexes, the mutation high-water mark, and paired-delete trigger", async () => {
    const customerColumns = await env.DB.prepare("PRAGMA table_info(customers)")
      .all<{ name: string }>();
    expect(customerColumns.results.map((column) => column.name))
      .toContain("latest_mutation_telegram_update_id");
    const objects = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('index', 'trigger') ORDER BY name"
    ).all<{ name: string }>();
    expect(objects.results.map((row) => row.name)).toEqual(expect.arrayContaining([
      "idx_mutation_receipts_customer_completed",
      "idx_leaderboard_reset_retention",
      "idx_processed_updates_retention",
      "transactions_delete_completed_receipt"
    ]));
  });

  it("creates suffix, history, and timestamp indexes", async () => {
    const rows = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name"
    ).all<{ name: string }>();
    const names = rows.results.map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining([
      "idx_customers_phone_last4",
      "idx_customers_phone_last5",
      "idx_transactions_customer_newest",
      "idx_transactions_created_at"
      , "idx_mutation_receipts_customer", "idx_leaderboard_top10"
    ]));
  });

  it("enforces the customer foreign key and unique mutation update ID", async () => {
    const foreignKeys = await env.DB.prepare("PRAGMA foreign_key_list(transactions)")
      .all<{ table: string; from: string; to: string }>();
    expect(foreignKeys.results).toContainEqual(
      expect.objectContaining({ table: "customers", from: "customer_id", to: "id" })
    );
    const indexes = await env.DB.prepare("PRAGMA index_list(transactions)")
      .all<{ name: string; unique: number }>();
    expect(indexes.results.some((index) => index.unique === 1)).toBe(true);
  });

  it("enforces unique phone and nonnegative balance constraints", async () => {
    const timestamp = new Date().toISOString();
    await customers().createZeroBalance(normalizePhone("01712345678"), 1, timestamp);
    const duplicate = await customers().createZeroBalance(normalizePhone("+8801712345678"), 2, timestamp);
    expect(duplicate.created).toBe(false);
    await expect(env.DB.prepare(
      "UPDATE customers SET point_balance_units = -1 WHERE id = ?"
    ).bind(duplicate.customer.id).run()).rejects.toThrow();
  });
});

describe("customer repository and deterministic suffix search", () => {
  it("creates a zero-point idempotent customer with suffixes and no transaction", async () => {
    const repository = customers();
    const first = await repository.createZeroBalance(normalizePhone("01712345678"), 10, new Date().toISOString());
    const replay = await repository.createZeroBalance(normalizePhone("01712345678"), 10, new Date().toISOString());
    expect(first.created).toBe(true);
    expect(first.customer).toMatchObject({
      pointBalanceUnits: 0,
      roundedRewardBdt: 0,
      phoneLast4: "5678",
      phoneLast5: "45678"
    });
    expect(replay.customer.id).toBe(first.customer.id);
    expect((await transactions().listForCustomer(first.customer.id, 0)).transactions).toHaveLength(0);
  });

  it("returns one, multiple, no matches, and at most eight per page", async () => {
    const repository = customers();
    await repository.createZeroBalance(
      normalizePhone("+14155550000"),
      99,
      new Date().toISOString()
    );
    for (let index = 0; index < 10; index += 1) {
      const phone = normalizePhone(`+1415${String(index).padStart(6, "0")}4567`);
      await repository.createZeroBalance(phone, index + 100, new Date().toISOString());
    }
    expect((await repository.searchBySuffix("0000", 0)).customers).toHaveLength(1);
    expect((await repository.searchBySuffix("9999", 0)).customers).toHaveLength(0);
    const first = await repository.searchBySuffix("4567", 0);
    const second = await repository.searchBySuffix("4567", 1);
    expect(first.customers).toHaveLength(8);
    expect(first.hasNext).toBe(true);
    expect(second.customers).toHaveLength(2);
    expect(second.hasNext).toBe(false);
    expect(first.customers[0]?.id).toBeLessThan(first.customers[1]?.id ?? 0);
  });
});

describe("atomic reward mutations and idempotency", () => {
  it("records purchase snapshots and does not process a duplicate twice", async () => {
    const created = await customers().createZeroBalance(
      normalizePhone("01712345678"),
      1,
      new Date().toISOString()
    );
    const service = new RewardMutationService(env.DB);
    const input = {
      customerId: created.customer.id,
      type: "PURCHASE" as const,
      pointUnits: purchaseToPointUnits(525),
      purchaseAmountBdt: 525,
      note: null,
      telegramUpdateId: 500,
      expectedBalanceUnits: 0
    };
    const first = await service.mutate(input);
    const replay = await service.mutate(input);
    expect(first).toMatchObject({
      balanceBeforeUnits: 0,
      balanceAfterUnits: 65_625,
      roundedRewardBeforeBdt: 0,
      roundedRewardAfterBdt: 2,
      duplicate: false
    });
    expect(replay.duplicate).toBe(true);
    const page = await transactions().listForCustomer(created.customer.id, 0);
    expect(page.transactions).toHaveLength(1);
    expect(page.transactions[0]).toMatchObject({
      transactionType: "PURCHASE",
      purchaseAmountBdt: 525,
      pointsDeltaUnits: 65_625
    });
  });

  it("supports fractional manual addition and redemption with signed append-only history", async () => {
    const created = await customers().createZeroBalance(
      normalizePhone("01712345678"),
      1,
      new Date().toISOString()
    );
    const service = new RewardMutationService(env.DB);
    await service.mutate({
      customerId: created.customer.id,
      type: "MANUAL_ADD",
      pointUnits: 65_625,
      purchaseAmountBdt: null,
      note: "<safe at display>",
      telegramUpdateId: 501,
      expectedBalanceUnits: 0
    });
    const redeemed = await service.mutate({
      customerId: created.customer.id,
      type: "REDEEM",
      pointUnits: 12_500,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 502,
      expectedBalanceUnits: 65_625
    });
    expect(redeemed.balanceAfterUnits).toBe(53_125);
    const page = await transactions().listForCustomer(created.customer.id, 0);
    expect(page.transactions.map((row) => row.telegramUpdateId)).toEqual([502, 501]);
    expect(page.transactions[0]?.pointsDeltaUnits).toBe(-12_500);
    expect(page.transactions[1]?.note).toBe("<safe at display>");
  });

  it("prevents insufficient redemption and inserts no history", async () => {
    const created = await customers().createZeroBalance(
      normalizePhone("01712345678"),
      1,
      new Date().toISOString()
    );
    const service = new RewardMutationService(env.DB);
    await expect(service.mutate({
      customerId: created.customer.id,
      type: "REDEEM",
      pointUnits: 1,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 503,
      expectedBalanceUnits: 0
    })).rejects.toThrow(/enough points/i);
    expect((await transactions().listForCustomer(created.customer.id, 0)).transactions).toHaveLength(0);
  });

  it("detects optimistic conflicts before updating either balance or history", async () => {
    const created = await customers().createZeroBalance(
      normalizePhone("01712345678"),
      1,
      new Date().toISOString()
    );
    await expect(new RewardMutationService(env.DB).mutate({
      customerId: created.customer.id,
      type: "MANUAL_ADD",
      pointUnits: 1,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 504,
      expectedBalanceUnits: 100
    })).rejects.toThrow(/balance changed/i);
    expect((await customers().findById(created.customer.id))?.pointBalanceUnits).toBe(0);
    expect((await transactions().listForCustomer(created.customer.id, 0)).transactions).toHaveLength(0);
  });

  it("rolls back the customer update when a real D1 transaction insertion fails", async () => {
    const created = await customers().createZeroBalance(
      normalizePhone("01712345678"),
      1,
      new Date().toISOString()
    );
    await env.DB.prepare(
      `CREATE TRIGGER audit_force_transaction_failure
       BEFORE INSERT ON transactions
       BEGIN
         SELECT RAISE(ABORT, 'forced transaction insertion failure');
       END`
    ).run();
    try {
      await expect(new RewardMutationService(env.DB).mutate({
        customerId: created.customer.id,
        type: "MANUAL_ADD",
        pointUnits: 10_000,
        purchaseAmountBdt: null,
        note: null,
        telegramUpdateId: 505,
        expectedBalanceUnits: 0
      })).rejects.toThrow();
    } finally {
      await env.DB.prepare("DROP TRIGGER audit_force_transaction_failure").run();
    }
    expect((await customers().findById(created.customer.id))?.pointBalanceUnits).toBe(0);
    expect((await transactions().listForCustomer(created.customer.id, 0)).transactions).toHaveLength(0);
  });

  it("rejects the second of two concurrent-style mutations using the same expected balance", async () => {
    const created = await customers().createZeroBalance(
      normalizePhone("01712345678"),
      1,
      new Date().toISOString()
    );
    const service = new RewardMutationService(env.DB);
    await service.mutate({
      customerId: created.customer.id,
      type: "MANUAL_ADD",
      pointUnits: 10_000,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 506,
      expectedBalanceUnits: 0
    });
    await expect(service.mutate({
      customerId: created.customer.id,
      type: "MANUAL_ADD",
      pointUnits: 20_000,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 507,
      expectedBalanceUnits: 0
    })).rejects.toThrow(/balance changed/i);
    expect((await customers().findById(created.customer.id))?.pointBalanceUnits).toBe(10_000);
    expect((await transactions().listForCustomer(created.customer.id, 0)).transactions).toHaveLength(1);
  });

  it("enforces the purchase formula at the mutation service boundary", async () => {
    const created = await customers().createZeroBalance(
      normalizePhone("01712345678"),
      1,
      new Date().toISOString()
    );
    await expect(new RewardMutationService(env.DB).mutate({
      customerId: created.customer.id,
      type: "PURCHASE",
      pointUnits: 1,
      purchaseAmountBdt: 525,
      note: null,
      telegramUpdateId: 508,
      expectedBalanceUnits: 0
    })).rejects.toThrow(/must match/i);
  });

  it("redeems exactly 8 of 20 points with correct reward snapshots", async () => {
    const created = await customers().createZeroBalance(
      normalizePhone("01712345678"),
      1,
      new Date().toISOString()
    );
    const service = new RewardMutationService(env.DB);
    await service.mutate({
      customerId: created.customer.id,
      type: "MANUAL_ADD",
      pointUnits: 200_000,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 509,
      expectedBalanceUnits: 0
    });
    const redemption = await service.mutate({
      customerId: created.customer.id,
      type: "REDEEM",
      pointUnits: 80_000,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 510,
      expectedBalanceUnits: 200_000
    });
    expect(redemption).toMatchObject({
      balanceAfterUnits: 120_000,
      roundedRewardAfterBdt: 3,
      transactionRewardRoundedBdt: 2
    });
    const history = await transactions().listForCustomer(created.customer.id, 0);
    expect(history.transactions[0]).toMatchObject({
      transactionType: "REDEEM",
      pointsDeltaUnits: -80_000
    });
  });
});

describe("D1 conversation state", () => {
  it("stores validated typed state and Search Again-style resets safely", async () => {
    const repository = new StateRepository(env.DB, 30);
    const initial = await repository.start("123", "PURCHASE", "SELECT_MODE", 100);
    const searched = await repository.save({
      ...initial,
      currentStep: "SHOW_RESULTS",
      selectionMode: "SUFFIX",
      searchDigits: "5678",
      searchPage: 3
    });
    const rotated = newStateToken();
    const reset = await repository.save({
      ...searched,
      currentStep: "AWAIT_SEARCH",
      selectedCustomerId: null,
      selectedWhatsappNumber: null,
      searchDigits: null,
      searchPage: 0,
      payload: { token: rotated }
    });
    expect(reset.activeOperation).toBe("PURCHASE");
    expect(reset.searchDigits).toBeNull();
    expect(reset.searchPage).toBe(0);
    expect(reset.payload.token).toBe(rotated);
    expect(reset.payload.token).not.toBe(initial.payload.token);
  });

  it("clears expired state and rejects unvalidated payload JSON", async () => {
    const repository = new StateRepository(env.DB, 30);
    await repository.start("123", "PURCHASE", "SELECT_MODE", 100);
    await env.DB.prepare(
      "UPDATE conversation_states SET expires_at_utc = ? WHERE administrator_telegram_id = '123'"
    ).bind("2000-01-01T00:00:00.000Z").run();
    expect(await repository.get("123")).toEqual({ state: null, expired: true });

    await repository.start("123", "PURCHASE", "SELECT_MODE", 100);
    await env.DB.prepare(
      "UPDATE conversation_states SET payload_json = ? WHERE administrator_telegram_id = '123'"
    ).bind('{"token":5}').run();
    await expect(repository.get("123")).rejects.toThrow(/conversation state/i);
  });
});

describe("export delivery idempotency", () => {
  it("preserves per-file progress when a failed complete export is reclaimed", async () => {
    const repository = new IdempotencyRepository(env.DB);
    expect(await repository.claim(900, "EXPORT")).toBe(true);
    await repository.setExportProgress(900, "CUSTOMERS_SENT");
    await repository.fail(900);
    expect(await repository.claim(900, "EXPORT")).toBe(true);
    expect(await repository.getExportProgress(900)).toBe("CUSTOMERS_SENT");
    await repository.setExportProgress(900, "BOTH_SENT");
    await repository.complete(900);
    expect(await repository.claim(900, "EXPORT")).toBe(false);
  });

  it("allows a stale processing claim to resume without losing file progress", async () => {
    const repository = new IdempotencyRepository(env.DB);
    expect(await repository.claim(901, "EXPORT")).toBe(true);
    await repository.setExportProgress(901, "CUSTOMERS_SENT");
    await env.DB.prepare(
      "UPDATE processed_updates SET processed_at_utc = ? WHERE telegram_update_id = ?"
    ).bind("2000-01-01T00:00:00.000Z", 901).run();
    expect(await repository.claim(901, "EXPORT")).toBe(true);
    expect(await repository.getExportProgress(901)).toBe("CUSTOMERS_SENT");
  });
});
