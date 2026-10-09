import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerRepository } from "../src/database/customer-repository";
import { CustomerMergeRepository } from "../src/database/customer-merge-repository";
import { CustomerSplitRepository } from "../src/database/customer-split-repository";
import { customerSplitAccountCount } from "../src/domain/customer-split";
import { customerMergeConfirmationMessage } from "../src/telegram/messages";
import { StateRepository } from "../src/database/state-repository";
import { RewardMutationService } from "../src/application/mutation-service";
import { customerMergeFingerprint, mergedCustomerBalance } from "../src/domain/customer-merge";
import { normalizePhone } from "../src/domain/phone";
import { normalizeUsername } from "../src/domain/customer-identity";
import { leaderboardPeriods } from "../src/domain/leaderboard";
import { LeaderboardRepository } from "../src/database/leaderboard-repository";
import { DashboardRepository } from "../src/database/dashboard-repository";
import { TransactionRepository } from "../src/database/transaction-repository";
import { ExportService } from "../src/exports/export-service";
import { purchaseToPointUnits, roundRewardBdt, SQLITE_MAX_INTEGER } from "../src/domain/rewards";
import { processTelegramUpdate } from "../src/application/bot-controller";
import { makeWorkflowContext } from "../src/workflows/context";
import { readConfig } from "../src/env";
import type { ConversationState, Customer } from "../src/types/models";
import type { TelegramUpdate } from "../src/telegram/types";

const customers = (): CustomerRepository => new CustomerRepository(env.DB);
const states = (): StateRepository => new StateRepository(env.DB, 30);
const rows = async (table: string): Promise<Record<string, unknown>[]> =>
  (await env.DB.prepare(`SELECT * FROM ${table}`).all()).results;

const prepare = async (target: Customer, source: Customer, updateId = 1000): Promise<ConversationState> => {
  const state = await states().start("123456789", "MANAGE_CUSTOMER", "MANAGE_CUSTOMER", updateId);
  return states().save({ ...state, currentStep: "CONFIRM_CUSTOMER_MERGE", selectedCustomerId: target.id,
    payload: { token: state.payload.token, mergeSourceCustomerId: source.id,
      mergeTargetFingerprint: await customerMergeFingerprint(target),
      mergeSourceFingerprint: await customerMergeFingerprint(source) } });
};

const seed = async (): Promise<{ target: Customer; source: Customer }> => {
  const timestamp = new Date().toISOString();
  const target = (await customers().createZeroBalance(normalizePhone("01700000001"), 1, timestamp)).customer;
  const source = (await customers().createZeroBalance({ type: "WHATSAPP_USERNAME",
    username: normalizeUsername("WHATSAPP_USERNAME", "Merge.User") }, 2, timestamp)).customer;
  const service = new RewardMutationService(env.DB);
  const a = await service.mutate({ customerId: target.id, type: "MANUAL_ADD", pointUnits: 1_000_000,
    purchaseAmountBdt: null, note: "first account", telegramUpdateId: 3, expectedBalanceUnits: 0 });
  const b = await service.mutate({ customerId: source.id, type: "MANUAL_ADD", pointUnits: 2_000_000,
    purchaseAmountBdt: null, note: "second account", telegramUpdateId: 4, expectedBalanceUnits: 0 });
  return { target: a.customer, source: b.customer };
};

const message = (updateId: number, text: string): TelegramUpdate => ({ updateId, kind: "message",
  message: { message_id: updateId, from: { id: 123456789 }, chat: { id: 123456789 }, text } });
const callback = (updateId: number, data: string): TelegramUpdate => ({ updateId, kind: "callback",
  callbackQuery: { id: `merge-${updateId}`, from: { id: 123456789 }, data,
    message: { message_id: 100, chat: { id: 123456789 } } } });

const texts: string[] = [];
let failDisplay = false;
const fakeFetch: typeof fetch = (_input, init) => {
  const value: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
  if (typeof value !== "object" || value === null) throw new Error("Invalid Telegram request.");
  if ("text" in value && typeof value.text === "string") {
    texts.push(value.text);
    if (failDisplay) return Promise.resolve(new Response(JSON.stringify({ ok: false, description: "offline" }), { status: 400 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ ok: true,
    result: { message_id: 100, chat: { id: 123456789 } } }), { status: 200 }));
};

beforeEach(async () => {
  texts.length = 0;
  failDisplay = false;
  await env.DB.batch(["processed_updates", "conversation_states", "customer_merge_receipts", "customer_split_receipts",
    "leaderboard_reset_receipts", "leaderboard_aggregates", "leaderboard_periods",
    "lifetime_redemption_snapshots", "transactions", "mutation_receipts", "customers"]
    .map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
});

describe("atomic customer merging", () => {
  it("combines 100 + 200 points, identities, history, leaderboard earnings and exports without new reward activity", async () => {
    const { target, source } = await seed();
    await customers().changeIdentifier(source.id, "TELEGRAM_USERNAME", null,
      { type: "TELEGRAM_USERNAME", username: normalizeUsername("TELEGRAM_USERNAME", "Merge_TG") }, new Date().toISOString());
    const refreshed = await customers().findById(source.id);
    if (refreshed === null) throw new Error("Missing fixture.");
    const before = await rows("transactions");
    const state = await prepare(target, refreshed);
    const result = await new CustomerMergeRepository(env.DB).merge(state, 1001);
    expect(result).toMatchObject({ duplicate: false, mergedBalanceUnits: 3_000_000,
      customer: { id: target.id, whatsappNumber: target.whatsappNumber, whatsappUsername: "Merge.User",
        telegramUsername: "Merge_TG", pointBalanceUnits: 3_000_000, roundedRewardBdt: 75 } });
    expect(await customers().findById(source.id)).toBeNull();
    expect((await customers().findByWhatsappUsername("merge.user"))?.id).toBe(target.id);
    expect((await customers().findByTelegramUsername("merge_tg"))?.id).toBe(target.id);
    expect((await customers().searchBySuffix("0001", 0)).customers).toHaveLength(1);
    expect(await rows("transactions")).toEqual(before.map((row) => ({ ...row, customer_id: target.id })));
    expect(await rows("lifetime_redemption_snapshots")).toEqual([]);
    for (const type of ["WEEK", "MONTH"] as const) {
      const period = leaderboardPeriods(type, new Date())[0];
      if (period === undefined) throw new Error("Missing period.");
      expect(await new LeaderboardRepository(env.DB).list(period))
        .toMatchObject([{ customerId: target.id, earnedPointUnits: 3_000_000 }]);
    }
    expect((await new TransactionRepository(env.DB).listForCustomer(target.id, 0)).transactions).toHaveLength(2);
    expect((await new TransactionRepository(env.DB).findLatestEarningForCustomer(target.id))?.telegramUpdateId).toBe(4);
    const exportService = new ExportService(env.DB, 100, 100000);
    expect((await exportService.customersCsv()).contents).toContain(",CUSTOMER,300,3000000,75,");
    expect((await exportService.transactionsCsv()).contents).toContain("Merge.User");
    expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    expect((await new DashboardRepository(env.DB).summary()).customerCount).toBe(1);
  });

  it("supports Quick Buy by phone, purchase, manual add, redemption and later identity edits", async () => {
    const { target, source } = await seed();
    const state = await prepare(target, source);
    await new CustomerMergeRepository(env.DB).merge(state, 1001);
    await states().clearIfCurrent(state);
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(1002, "/quickbuy"));
    await processTelegramUpdate(context, message(1003, "01700000001\n500"));
    const afterQuick = 3_000_000 + purchaseToPointUnits(500);
    expect((await customers().findByPhone("+8801700000001"))?.pointBalanceUnits).toBe(afterQuick);
    const service = new RewardMutationService(env.DB);
    const bought = await service.mutate({ customerId: target.id, type: "PURCHASE", pointUnits: purchaseToPointUnits(2000),
      purchaseAmountBdt: 2000, note: null, telegramUpdateId: 1004, expectedBalanceUnits: afterQuick });
    const added = await service.mutate({ customerId: target.id, type: "MANUAL_ADD", pointUnits: 12_345,
      purchaseAmountBdt: null, note: "post merge", telegramUpdateId: 1005, expectedBalanceUnits: bought.balanceAfterUnits });
    const redeemed = await service.mutate({ customerId: target.id, type: "REDEEM", pointUnits: 1_000_000,
      purchaseAmountBdt: null, note: null, telegramUpdateId: 1006, expectedBalanceUnits: added.balanceAfterUnits });
    expect(redeemed.balanceAfterUnits).toBe(added.balanceAfterUnits - 1_000_000);
    const changed = await customers().changeIdentifier(target.id, "WHATSAPP_USERNAME", "Merge.User",
      { type: "WHATSAPP_USERNAME", username: normalizeUsername("WHATSAPP_USERNAME", "Later.User") }, new Date().toISOString());
    expect(changed.customer.pointBalanceUnits).toBe(redeemed.balanceAfterUnits);
    expect((await rows("lifetime_redemption_snapshots"))[0]).toMatchObject({ redemption_count: 1, cumulative_redeemed_point_units: 1_000_000 });
    expect(await rows("customers")).toHaveLength(1);
  });

  it("keeps merge retries and moved reward receipts idempotent, including after another merge", async () => {
    const { target, source } = await seed();
    const state = await prepare(target, source);
    const merges = new CustomerMergeRepository(env.DB);
    await merges.merge(state, 1001);
    expect(await merges.merge(state, 1002)).toMatchObject({ duplicate: true, mergedBalanceUnits: 3_000_000 });
    expect(await new RewardMutationService(env.DB).mutate({ customerId: source.id, type: "MANUAL_ADD",
      pointUnits: 2_000_000, purchaseAmountBdt: null, note: null, telegramUpdateId: 4, expectedBalanceUnits: 0 }))
      .toMatchObject({ duplicate: true, customer: { id: target.id, pointBalanceUnits: 3_000_000 } });
    const third = (await customers().createZeroBalance({ type: "TELEGRAM_USERNAME",
      username: normalizeUsername("TELEGRAM_USERNAME", "Third_User") }, 1003, new Date().toISOString())).customer;
    const merged = await customers().findById(target.id);
    if (merged === null) throw new Error("Missing fixture.");
    const next = await prepare(third, merged, 1004);
    await merges.merge(next, 1005);
    expect(await merges.merge(state, 1006)).toMatchObject({ duplicate: true, customer: { id: third.id, pointBalanceUnits: 3_000_000 } });
    expect((await customers().createZeroBalance({ type: "WHATSAPP_USERNAME",
      username: normalizeUsername("WHATSAPP_USERNAME", "Old_Replay") }, 2, new Date().toISOString())).customer.id).toBe(third.id);
    expect(await customers().findByWhatsappUsername("Old_Replay")).toBeNull();
    expect(await rows("customers")).toHaveLength(1);
  });

  it("rejects changes after preview and invalidates other pending customer workflows", async () => {
    const { target, source } = await seed();
    const state = await prepare(target, source);
    await customers().changeIdentifier(source.id, "WHATSAPP_USERNAME", "Merge.User",
      { type: "WHATSAPP_USERNAME", username: normalizeUsername("WHATSAPP_USERNAME", "Changed.User") }, new Date().toISOString());
    await expect(new CustomerMergeRepository(env.DB).merge(state, 1001)).rejects.toMatchObject({ code: "IDENTIFIER_STALE" });
    expect(await rows("customers")).toHaveLength(2);
    expect(await rows("customer_merge_receipts")).toEqual([]);
    const refreshed = await customers().findById(source.id);
    if (refreshed === null) throw new Error("Missing fixture.");
    const valid = await prepare(target, refreshed, 1002);
    const other = await states().start("987654321", "REDEEM", "CONFIRM_REDEEM", 1000);
    await states().save({ ...other, selectedCustomerId: target.id });
    await new CustomerMergeRepository(env.DB).merge(valid, 1003);
    expect((await states().get("987654321")).state).toBeNull();
    expect((await states().get("123456789")).state?.payload.token).toBe(valid.payload.token);
  });

  it("rolls back the entire merge on a database failure and can retry", async () => {
    const { target, source } = await seed();
    const state = await prepare(target, source);
    const before = await Promise.all(["customers", "transactions", "mutation_receipts", "leaderboard_aggregates"].map(rows));
    await env.DB.exec("CREATE TRIGGER merge_failure BEFORE DELETE ON customers BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    try {
      await expect(new CustomerMergeRepository(env.DB).merge(state, 1001)).rejects.toThrow();
      expect(await Promise.all(["customers", "transactions", "mutation_receipts", "leaderboard_aggregates"].map(rows))).toEqual(before);
      expect(await rows("customer_merge_receipts")).toEqual([]);
    } finally { await env.DB.exec("DROP TRIGGER merge_failure;"); }
    expect((await new CustomerMergeRepository(env.DB).merge(state, 1001)).customer.pointBalanceUnits).toBe(3_000_000);
  });

  it("blocks conflicting identities, mixed account types and unsafe balances", async () => {
    const { target, source } = await seed();
    expect(() => mergedCustomerBalance(target, { ...source, whatsappNumber: "+8801700000002" })).toThrow("conflicting");
    expect(() => mergedCustomerBalance(target, { ...source, isTest: true })).toThrow("Test accounts");
    expect(() => mergedCustomerBalance({ ...target, pointBalanceUnits: SQLITE_MAX_INTEGER }, source)).toThrow("safe range");
    expect(() => mergedCustomerBalance(target, target)).toThrow("different customers");
  });

  it("rounds the combined exact units once rather than summing rounded rewards", async () => {
    const { target, source } = await seed();
    await env.DB.prepare("UPDATE customers SET point_balance_units = 20000, rounded_reward_bdt = 1").run();
    const a = await customers().findById(target.id);
    const b = await customers().findById(source.id);
    if (a === null || b === null) throw new Error("Missing fixture.");
    const result = await new CustomerMergeRepository(env.DB).merge(await prepare(a, b), 1001);
    expect(result.customer).toMatchObject({ pointBalanceUnits: 40000, roundedRewardBdt: roundRewardBdt(40000) });
    expect(result.customer.roundedRewardBdt).toBe(1);
  });

  it("allows two test accounts to merge while keeping analytics excluded", async () => {
    const { target, source } = await seed();
    const a = (await customers().changeTestAccountStatus(target.id, false, true, new Date().toISOString())).customer;
    const b = (await customers().changeTestAccountStatus(source.id, false, true, new Date().toISOString())).customer;
    const result = await new CustomerMergeRepository(env.DB).merge(await prepare(a, b), 1001);
    expect(result.customer.isTest).toBe(true);
    expect(await rows("leaderboard_aggregates")).toEqual([]);
    expect((await new DashboardRepository(env.DB).summary()).customerCount).toBe(0);
    await new RewardMutationService(env.DB).mutate({ customerId: target.id, type: "REDEEM", pointUnits: 3_000_000,
      purchaseAmountBdt: null, note: null, telegramUpdateId: 1002, expectedBalanceUnits: 3_000_000 });
    expect(await rows("lifetime_redemption_snapshots")).toEqual([]);
    expect((await customers().changeTestAccountStatus(target.id, true, false, new Date().toISOString())).customer.isTest).toBe(false);
    expect(await rows("leaderboard_aggregates")).toEqual([]);
  });

  it("rolls back when combined leaderboard units overflow even if customer balances are safe", async () => {
    const { target, source } = await seed();
    await env.DB.prepare("UPDATE leaderboard_aggregates SET earned_point_units = ? WHERE customer_id = ?")
      .bind(SQLITE_MAX_INTEGER, target.id).run();
    const state = await prepare(target, source);
    const before = await Promise.all(["customers", "transactions", "mutation_receipts", "leaderboard_aggregates"].map(rows));
    await expect(new CustomerMergeRepository(env.DB).merge(state, 1001)).rejects.toThrow();
    expect(await Promise.all(["customers", "transactions", "mutation_receipts", "leaderboard_aggregates"].map(rows))).toEqual(before);
    expect(await rows("customer_merge_receipts")).toEqual([]);
  });

  it("rejects a replaced workflow inside the atomic batch", async () => {
    const { target, source } = await seed();
    const state = await prepare(target, source);
    await states().start("123456789", "PURCHASE", "SELECT_MODE", 1002);
    await expect(new CustomerMergeRepository(env.DB).merge(state, 1003)).rejects.toMatchObject({ code: "IDENTIFIER_STALE" });
    expect(await rows("customers")).toHaveLength(2);
    expect(await rows("customer_merge_receipts")).toEqual([]);
    expect((await states().get("123456789")).state?.activeOperation).toBe("PURCHASE");
  });

  it("guards customer snapshots against a balance change between read and batch execution", async () => {
    const { target, source } = await seed();
    const state = await prepare(target, source);
    const batch = env.DB.batch.bind(env.DB);
    const spy = vi.spyOn(env.DB, "batch").mockImplementationOnce(async (statements) => {
      await env.DB.prepare("UPDATE customers SET point_balance_units = point_balance_units + 1 WHERE id = ?").bind(source.id).run();
      return batch(statements);
    });
    try {
      await expect(new CustomerMergeRepository(env.DB).merge(state, 1001)).rejects.toMatchObject({ code: "IDENTIFIER_STALE" });
    } finally { spy.mockRestore(); }
    expect(await rows("customers")).toHaveLength(2);
    expect((await customers().findById(target.id))?.pointBalanceUnits).toBe(1_000_000);
    expect((await customers().findById(source.id))?.pointBalanceUnits).toBe(2_000_001);
    expect(await rows("customer_merge_receipts")).toEqual([]);
  });

  it("two concurrent confirmations merge once", async () => {
    const { target, source } = await seed();
    const state = await prepare(target, source);
    const merges = new CustomerMergeRepository(env.DB);
    const results = await Promise.all([merges.merge(state, 1001), merges.merge(state, 1002)]);
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect((await customers().findById(target.id))?.pointBalanceUnits).toBe(3_000_000);
    expect(await rows("customer_merge_receipts")).toHaveLength(1);
  });

  it("blocks old identity and classification writes after merging", async () => {
    const { target, source } = await seed();
    const pending = await states().start("987654321", "MANAGE_CUSTOMER", "CONFIRM_IDENTITY_CHANGE", 900);
    const oldIdentity = await states().save({ ...pending, selectedCustomerId: target.id });
    const classification = await states().start("987654322", "MANAGE_TEST_ACCOUNT", "CONFIRM_TEST_ACCOUNT_CHANGE", 901);
    const oldClassification = await states().save({ ...classification, selectedCustomerId: target.id });
    await new CustomerMergeRepository(env.DB).merge(await prepare(target, source), 1001);
    await expect(customers().changeIdentifier(target.id, "TELEGRAM_USERNAME", null,
      { type: "TELEGRAM_USERNAME", username: normalizeUsername("TELEGRAM_USERNAME", "Stale_User") },
      new Date().toISOString(), oldIdentity)).rejects.toMatchObject({ code: "IDENTIFIER_STALE" });
    await expect(customers().changeTestAccountStatus(target.id, false, true,
      new Date().toISOString(), oldClassification)).rejects.toMatchObject({ code: "IDENTIFIER_STALE" });
    expect((await customers().findById(target.id))?.isTest).toBe(false);
    expect((await customers().findById(target.id))?.telegramUsername).toBeNull();
    expect(await rows("leaderboard_aggregates")).toHaveLength(2);
  });

  it("preserves only the combined newest 40 transactions and receipts and rejects a pruned delayed update", async () => {
    const { target, source } = await seed();
    const service = new RewardMutationService(env.DB);
    let a = target; let b = source;
    for (let i = 0; i < 24; i++) {
      a = (await service.mutate({ customerId: a.id, type: "MANUAL_ADD", pointUnits: 10000,
        purchaseAmountBdt: null, note: null, telegramUpdateId: 10 + i * 2, expectedBalanceUnits: a.pointBalanceUnits })).customer;
      b = (await service.mutate({ customerId: b.id, type: "MANUAL_ADD", pointUnits: 10000,
        purchaseAmountBdt: null, note: null, telegramUpdateId: 11 + i * 2, expectedBalanceUnits: b.pointBalanceUnits })).customer;
    }
    const newest = (await env.DB.prepare("SELECT telegram_update_id FROM transactions ORDER BY created_at_utc DESC, id DESC LIMIT 40").all()).results;
    await new CustomerMergeRepository(env.DB).merge(await prepare(a, b), 1001);
    expect((await env.DB.prepare("SELECT telegram_update_id FROM transactions ORDER BY created_at_utc DESC, id DESC").all()).results).toEqual(newest);
    expect(await rows("mutation_receipts")).toHaveLength(40);
    await expect(service.mutate({ customerId: a.id, type: "MANUAL_ADD", pointUnits: 10000,
      purchaseAmountBdt: null, note: null, telegramUpdateId: 3, expectedBalanceUnits: a.pointBalanceUnits + b.pointBalanceUnits }))
      .rejects.toMatchObject({ code: "BALANCE_CONFLICT" });
  });

  it("does not move older-period or pre-reset earnings into the current leaderboard", async () => {
    const { target, source } = await seed();
    const period = leaderboardPeriods("MONTH", new Date())[0];
    if (period === undefined) throw new Error("Missing period.");
    await env.DB.prepare("UPDATE leaderboard_periods SET current_generation = 1 WHERE period_type = 'MONTH' AND period_key = ?").bind(period.key).run();
    const timestamp = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO leaderboard_periods VALUES ('MONTH', '2000-01', 0, NULL, ?)").bind(timestamp),
      env.DB.prepare("INSERT INTO leaderboard_aggregates VALUES ('MONTH', '2000-01', 0, ?, 9999999, ?, ?)").bind(source.id, timestamp, timestamp),
      env.DB.prepare("INSERT INTO leaderboard_aggregates VALUES ('MONTH', ?, 1, ?, 12345, ?, ?)").bind(period.key, source.id, timestamp, timestamp)
    ]);
    await new CustomerMergeRepository(env.DB).merge(await prepare(target, source), 1001);
    expect(await new LeaderboardRepository(env.DB).list(period)).toMatchObject([{ customerId: target.id, earnedPointUnits: 12345 }]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM leaderboard_periods WHERE period_key = '2000-01'").first("n")).toBe(0);
    expect((await customers().findById(target.id))?.pointBalanceUnits).toBe(3_000_000);
  });
});

describe("merge Telegram workflow", () => {
  it("purchases through a merged username and redeems the complete balance through the phone", async () => {
    const { target, source } = await seed();
    const mergeState = await prepare(target, source);
    await new CustomerMergeRepository(env.DB).merge(mergeState, 1001);
    await states().clearIfCurrent(mergeState);
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(1002, "/purchase"));
    let state = (await states().get("123456789")).state;
    await processTelegramUpdate(context, callback(1003, `mode:w:${state?.payload.token ?? ""}`));
    await processTelegramUpdate(context, message(1004, "merge.user"));
    state = (await states().get("123456789")).state;
    expect(state).toMatchObject({ selectedCustomerId: target.id, currentStep: "AWAIT_PURCHASE_AMOUNT" });
    await processTelegramUpdate(context, message(1005, "500"));
    state = (await states().get("123456789")).state;
    expect(state?.currentStep).toBe("CONFIRM_PURCHASE");
    await processTelegramUpdate(context, callback(1006, `confirm:${state?.payload.token ?? ""}`));
    const balance = 3_000_000 + purchaseToPointUnits(500);
    expect((await customers().findById(target.id))?.pointBalanceUnits).toBe(balance);
    await processTelegramUpdate(context, message(1007, "/redeem"));
    state = (await states().get("123456789")).state;
    await processTelegramUpdate(context, callback(1008, `mode:f:${state?.payload.token ?? ""}`));
    await processTelegramUpdate(context, message(1009, "01700000001"));
    state = (await states().get("123456789")).state;
    await processTelegramUpdate(context, callback(1010, `redeemall:${state?.payload.token ?? ""}`));
    state = (await states().get("123456789")).state;
    expect(state).toMatchObject({ currentStep: "CONFIRM_REDEEM", payload: { pointUnits: balance, expectedBalanceUnits: balance } });
    expect((await customers().findById(target.id))?.pointBalanceUnits).toBe(balance);
    await processTelegramUpdate(context, callback(1011, `confirm:${state?.payload.token ?? ""}`));
    expect((await customers().findById(target.id))?.pointBalanceUnits).toBe(0);
    expect((await new TransactionRepository(env.DB).listForCustomer(target.id, 0)).transactions[0])
      .toMatchObject({ transactionType: "REDEEM", pointsDeltaUnits: -balance });
    for (const type of ["WEEK", "MONTH"] as const) {
      const period = leaderboardPeriods(type, new Date())[0];
      if (period === undefined) throw new Error("Missing period.");
      expect(await new LeaderboardRepository(env.DB).list(period))
        .toMatchObject([{ customerId: target.id, earnedPointUnits: balance }]);
    }
  });

  it("previews 300 points and Back or Cancel does not merge", async () => {
    const { target } = await seed();
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(1000, "/managecustomer"));
    let state = (await states().get("123456789")).state;
    await processTelegramUpdate(context, callback(1001, `mode:f:${state?.payload.token ?? ""}`));
    await processTelegramUpdate(context, message(1002, "01700000001"));
    state = (await states().get("123456789")).state;
    await processTelegramUpdate(context, callback(1003, `idedit:w:${state?.payload.token ?? ""}`));
    await processTelegramUpdate(context, message(1004, "@Merge.User"));
    state = (await states().get("123456789")).state;
    expect(state?.currentStep).toBe("CONFIRM_CUSTOMER_MERGE");
    expect(texts.at(-1)).toContain("Combined Balance: 300.00 points");
    const token = state?.payload.token ?? "";
    await processTelegramUpdate(context, callback(1005, `back:i:${token}`));
    expect((await states().get("123456789")).state?.currentStep).toBe("MANAGE_CUSTOMER");
    await processTelegramUpdate(context, callback(1006, `idmerge:${token}`));
    expect(await rows("customers")).toHaveLength(2);
    await processTelegramUpdate(context, callback(1007, "cancel"));
    expect((await customers().findById(target.id))?.pointBalanceUnits).toBe(1_000_000);
    expect(await rows("customer_merge_receipts")).toEqual([]);
  });

  it("keeps confirmation after a committed merge display fails and safely retries", async () => {
    const { target, source } = await seed();
    const state = await prepare(target, source);
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    failDisplay = true;
    await expect(processTelegramUpdate(context, callback(1001, `idmerge:${state.payload.token}`))).rejects.toThrow();
    expect((await customers().findById(target.id))?.pointBalanceUnits).toBe(3_000_000);
    expect((await states().get("123456789")).state?.payload.token).toBe(state.payload.token);
    failDisplay = false;
    await processTelegramUpdate(context, callback(1001, `idmerge:${state.payload.token}`));
    expect((await states().get("123456789")).state).toBeNull();
    expect((await customers().findById(target.id))?.pointBalanceUnits).toBe(3_000_000);
    expect(await rows("customer_merge_receipts")).toHaveLength(1);
    expect(texts.at(-1)).toContain("Customers Merged Successfully");
  });

  it("merges a Telegram-only account when its phone is owned by a second customer", async () => {
    const { target, source } = await seed();
    await customers().changeIdentifier(source.id, "TELEGRAM_USERNAME", null,
      { type: "TELEGRAM_USERNAME", username: normalizeUsername("TELEGRAM_USERNAME", "Phone_Later") }, new Date().toISOString());
    await customers().changeIdentifier(source.id, "WHATSAPP_USERNAME", "Merge.User", null, new Date().toISOString());
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(1000, "/managecustomer"));
    let state = (await states().get("123456789")).state;
    await processTelegramUpdate(context, callback(1001, `mode:t:${state?.payload.token ?? ""}`));
    await processTelegramUpdate(context, message(1002, "Phone_Later"));
    state = (await states().get("123456789")).state;
    await processTelegramUpdate(context, callback(1003, `idedit:p:${state?.payload.token ?? ""}`));
    await processTelegramUpdate(context, message(1004, "01700000001"));
    state = (await states().get("123456789")).state;
    expect(state?.currentStep).toBe("CONFIRM_CUSTOMER_MERGE");
    await processTelegramUpdate(context, callback(1005, `idmerge:${state?.payload.token ?? ""}`));
    expect((await customers().findByPhone("+8801700000001"))?.id).toBe(source.id);
    expect((await customers().findByTelegramUsername("phone_later"))?.pointBalanceUnits).toBe(3_000_000);
    expect(await customers().findById(target.id)).toBeNull();
  });
});

describe("migration 0010", () => {
  it("adds empty merge receipts without altering customer data or existing tables", async () => {
    const index = env.TEST_MIGRATIONS.findIndex((migration) => migration.name === "0010_customer_merges.sql");
    const migration = env.TEST_MIGRATIONS[index];
    if (migration === undefined) throw new Error("Missing migration.");
    await applyD1Migrations(env.MIGRATION_DB, env.TEST_MIGRATIONS.slice(0, index));
    const timestamp = new Date().toISOString();
    await env.MIGRATION_DB.prepare("INSERT INTO customers (telegram_username, point_balance_units, rounded_reward_bdt, created_at_utc, updated_at_utc) VALUES ('Existing_User', 12345, 0, ?, ?)").bind(timestamp, timestamp).run();
    const before = await env.MIGRATION_DB.prepare("SELECT * FROM customers").all();
    await applyD1Migrations(env.MIGRATION_DB, [migration]);
    expect((await env.MIGRATION_DB.prepare("SELECT * FROM customers").all()).results).toEqual(before.results);
    expect((await env.MIGRATION_DB.prepare("SELECT * FROM customer_merge_receipts").all()).results).toEqual([]);
    expect((await env.MIGRATION_DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });
});

const prepareSplit = async (customer: Customer, updateId = 2000): Promise<ConversationState> => {
  const state = await states().start("123456789", "MANAGE_CUSTOMER", "MANAGE_CUSTOMER", updateId);
  return states().save({ ...state, selectedCustomerId: customer.id, currentStep: "CONFIRM_CUSTOMER_SPLIT",
    payload: { token: state.payload.token, splitFingerprint: await customerMergeFingerprint(customer) } });
};

const mergedFixture = async (three = false): Promise<Customer> => {
  const { target, source } = await seed();
  if (three) {
    await customers().changeIdentifier(source.id, "TELEGRAM_USERNAME", null,
      { type: "TELEGRAM_USERNAME", username: normalizeUsername("TELEGRAM_USERNAME", "Split_User") }, new Date().toISOString());
  }
  const updatedSource = await customers().findById(source.id);
  if (updatedSource === null) throw new Error("Missing fixture.");
  return (await new CustomerMergeRepository(env.DB).merge(await prepare(target, updatedSource), 1001)).customer;
};

describe("split and reset points", () => {
  it("migration 0011 preserves existing business rows", async () => {
    const index = env.TEST_MIGRATIONS.findIndex((migration) => migration.name === "0011_customer_splits.sql");
    const migration = env.TEST_MIGRATIONS[index];
    if (migration === undefined) throw new Error("Missing split migration.");
    await applyD1Migrations(env.MIGRATION_DB, env.TEST_MIGRATIONS.slice(0, index));
    const timestamp = new Date().toISOString();
    await env.MIGRATION_DB.prepare("INSERT INTO customers (telegram_username, point_balance_units, rounded_reward_bdt, created_at_utc, updated_at_utc) VALUES ('Before_Split', 10000, 0, ?, ?)").bind(timestamp, timestamp).run();
    const before = (await env.MIGRATION_DB.prepare("SELECT * FROM customers").all()).results;
    await applyD1Migrations(env.MIGRATION_DB, [migration]);
    expect((await env.MIGRATION_DB.prepare("SELECT * FROM customers").all()).results).toEqual(before);
    expect((await env.MIGRATION_DB.prepare("SELECT * FROM customer_split_receipts").all()).results).toEqual([]);
    expect((await env.MIGRATION_DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });

  it("checks customer snapshots inside the split batch", async () => {
    const merged = await mergedFixture();
    const state = await prepareSplit(merged);
    const batch = env.DB.batch.bind(env.DB);
    const spy = vi.spyOn(env.DB, "batch").mockImplementationOnce(async (statements) => {
      await env.DB.prepare("UPDATE customers SET point_balance_units = point_balance_units + 1 WHERE id = ?").bind(merged.id).run();
      return batch(statements);
    });
    try {
      await expect(new CustomerSplitRepository(env.DB).split(state, 2001)).rejects.toMatchObject({ code: "IDENTIFIER_STALE" });
    } finally { spy.mockRestore(); }
    expect(await rows("customers")).toHaveLength(1);
    expect((await customers().findById(merged.id))?.pointBalanceUnits).toBe(3_000_001);
    expect(await rows("customer_split_receipts")).toEqual([]);
    expect(await rows("leaderboard_aggregates")).toHaveLength(2);
  });

  it.each([false, true])("splits every identifier into zero-point accounts (three=%s), preserving history and lifetime totals", async (three) => {
    const merged = await mergedFixture(three);
    const redeemed = await new RewardMutationService(env.DB).mutate({ customerId: merged.id, type: "REDEEM",
      pointUnits: 10000, purchaseAmountBdt: null, note: null, telegramUpdateId: 1002, expectedBalanceUnits: 3_000_000 });
    const history = await rows("transactions");
    const receipts = await rows("mutation_receipts");
    const lifetime = await rows("lifetime_redemption_snapshots");
    const result = await new CustomerSplitRepository(env.DB).split(await prepareSplit(redeemed.customer), 2001);
    expect(result).toEqual({ erasedPointUnits: 2_990_000, accountCount: three ? 3 : 2, duplicate: false });
    const accounts = await customers().listAll(10);
    expect(accounts).toHaveLength(three ? 3 : 2);
    for (const account of accounts) {
      expect(account.pointBalanceUnits).toBe(0);
      expect(account.roundedRewardBdt).toBe(0);
      expect(account.latestMutationTelegramUpdateId).toBe(2001);
      expect([account.whatsappNumber, account.whatsappUsername, account.telegramUsername].filter((value) => value !== null)).toHaveLength(1);
    }
    expect((await customers().findByPhone("+8801700000001"))?.id).toBe(merged.id);
    expect((await customers().findByWhatsappUsername("merge.user"))?.id).not.toBe(merged.id);
    if (three) expect((await customers().findByTelegramUsername("split_user"))?.pointBalanceUnits).toBe(0);
    expect(await rows("transactions")).toEqual(history);
    expect(await rows("mutation_receipts")).toEqual(receipts);
    expect(await rows("lifetime_redemption_snapshots")).toEqual(lifetime);
    expect(await rows("leaderboard_aggregates")).toEqual([]);
    expect((await new DashboardRepository(env.DB).summary()).currentPointUnits).toBe(0);
    expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    expect((await customers().findByCreationUpdateId(2))?.id).toBe(merged.id);
    expect((await new ExportService(env.DB, 100, 100000).customersCsv()).contents).toContain(",CUSTOMER,0,0,0,");
  });

  it("split retry leaves later Quick Buy points intact; accounts can earn, redeem, edit identities and merge again", async () => {
    const merged = await mergedFixture();
    const state = await prepareSplit(merged);
    const splits = new CustomerSplitRepository(env.DB);
    await splits.split(state, 2001);
    await states().clearIfCurrent(state);
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(2002, "/quickbuy"));
    await processTelegramUpdate(context, message(2003, "01700000001\n500"));
    expect(await splits.split(state, 2004)).toMatchObject({ duplicate: true, erasedPointUnits: 3_000_000 });
    const phone = await customers().findById(merged.id);
    const wa = await customers().findByWhatsappUsername("merge.user");
    if (phone === null || wa === null) throw new Error("Missing split account.");
    expect(phone.pointBalanceUnits).toBe(purchaseToPointUnits(500));
    const service = new RewardMutationService(env.DB);
    const earned = await service.mutate({ customerId: wa.id, type: "MANUAL_ADD", pointUnits: 12345,
      purchaseAmountBdt: null, note: "after split", telegramUpdateId: 2005, expectedBalanceUnits: 0 });
    const redeemed = await service.mutate({ customerId: wa.id, type: "REDEEM", pointUnits: 1000,
      purchaseAmountBdt: null, note: null, telegramUpdateId: 2006, expectedBalanceUnits: earned.balanceAfterUnits });
    await expect(service.mutate({ customerId: wa.id, type: "MANUAL_ADD", pointUnits: 12345,
      purchaseAmountBdt: null, note: null, telegramUpdateId: 1999, expectedBalanceUnits: redeemed.balanceAfterUnits }))
      .rejects.toMatchObject({ code: "BALANCE_CONFLICT" });
    const edited = await customers().changeIdentifier(wa.id, "WHATSAPP_USERNAME", "Merge.User",
      { type: "WHATSAPP_USERNAME", username: normalizeUsername("WHATSAPP_USERNAME", "Split.Later") }, new Date().toISOString());
    const remerged = await new CustomerMergeRepository(env.DB).merge(await prepare(phone, edited.customer, 2007), 2008);
    expect(remerged.customer.pointBalanceUnits).toBe(phone.pointBalanceUnits + 11345);
    expect(await rows("customers")).toHaveLength(1);
    expect(await splits.split(state, 2009)).toMatchObject({ duplicate: true });
    expect((await customers().findById(merged.id))?.pointBalanceUnits).toBe(remerged.customer.pointBalanceUnits);
  });

  it("supports username-only splits and retains test classification", async () => {
    const merged = await mergedFixture(true);
    await customers().changeIdentifier(merged.id, "WHATSAPP_PHONE", merged.whatsappNumber, null, new Date().toISOString());
    const test = (await customers().changeTestAccountStatus(merged.id, false, true, new Date().toISOString())).customer;
    await new CustomerSplitRepository(env.DB).split(await prepareSplit(test), 2001);
    expect((await customers().findByWhatsappUsername("merge.user"))?.id).toBe(merged.id);
    expect((await customers().findByTelegramUsername("split_user"))?.isTest).toBe(true);
    expect((await customers().listAll(10)).every((account) => account.isTest && account.pointBalanceUnits === 0)).toBe(true);
    expect((await new DashboardRepository(env.DB).summary()).customerCount).toBe(0);
  });

  it("rejects changed and cancelled confirmations and one-identifier accounts", async () => {
    const merged = await mergedFixture();
    const state = await prepareSplit(merged);
    await customers().changeIdentifier(merged.id, "WHATSAPP_USERNAME", "Merge.User",
      { type: "WHATSAPP_USERNAME", username: normalizeUsername("WHATSAPP_USERNAME", "Changed.Split") }, new Date().toISOString());
    await expect(new CustomerSplitRepository(env.DB).split(state, 2001)).rejects.toMatchObject({ code: "IDENTIFIER_STALE" });
    const changed = await customers().findById(merged.id);
    if (changed === null) throw new Error("Missing fixture.");
    const next = await prepareSplit(changed, 2002);
    await states().clearIfCurrent(next);
    await expect(new CustomerSplitRepository(env.DB).split(next, 2003)).rejects.toMatchObject({ code: "IDENTIFIER_STALE" });
    expect(await rows("customer_split_receipts")).toEqual([]);
    expect((await customers().findById(merged.id))?.pointBalanceUnits).toBe(3_000_000);
    expect(() => customerSplitAccountCount({ ...merged, whatsappUsername: null })).toThrow("two identifiers");
  });

  it("rolls back a failed account creation and allows retry", async () => {
    const merged = await mergedFixture();
    const state = await prepareSplit(merged);
    const before = await Promise.all(["customers", "transactions", "mutation_receipts", "leaderboard_aggregates"].map(rows));
    await env.DB.exec("CREATE TRIGGER split_failure BEFORE INSERT ON customers BEGIN SELECT RAISE(ABORT, 'split test failure'); END;");
    try {
      await expect(new CustomerSplitRepository(env.DB).split(state, 2001)).rejects.toThrow();
      expect(await Promise.all(["customers", "transactions", "mutation_receipts", "leaderboard_aggregates"].map(rows))).toEqual(before);
      expect(await rows("customer_split_receipts")).toEqual([]);
    } finally { await env.DB.exec("DROP TRIGGER split_failure;"); }
    expect(await new CustomerSplitRepository(env.DB).split(state, 2001)).toMatchObject({ duplicate: false });
  });

  it("concurrent confirmations split once and invalidate other selected workflows", async () => {
    const merged = await mergedFixture();
    const state = await prepareSplit(merged);
    const other = await states().start("987654321", "REDEEM", "CONFIRM_REDEEM", 1900);
    await states().save({ ...other, selectedCustomerId: merged.id });
    const splits = new CustomerSplitRepository(env.DB);
    const results = await Promise.all([splits.split(state, 2001), splits.split(state, 2002)]);
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(await rows("customers")).toHaveLength(2);
    expect(await rows("customer_split_receipts")).toHaveLength(1);
    expect((await states().get("987654321")).state).toBeNull();
  });

  it("warns on merge and split screens, Back cancels preview, and delivery failure retries safely", async () => {
    const { target, source } = await seed();
    expect(customerMergeConfirmationMessage(target, source, 3_000_000)).toContain("Previous balances will not be restored.");
    const merged = (await new CustomerMergeRepository(env.DB).merge(await prepare(target, source), 1001)).customer;
    const start = await states().start("123456789", "MANAGE_CUSTOMER", "MANAGE_CUSTOMER", 2000);
    let state = await states().save({ ...start, selectedCustomerId: merged.id });
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, callback(2001, `idsplit:${state.payload.token}`));
    let current = (await states().get("123456789")).state;
    if (current === null) throw new Error("Missing preview.");
    expect(current.currentStep).toBe("CONFIRM_CUSTOMER_SPLIT");
    expect(texts.at(-1)).toContain("Points to Erase: 300.00 points");
    expect(texts.at(-1)).toContain("erase their current points and leaderboard earnings");
    await processTelegramUpdate(context, callback(2002, `back:i:${current.payload.token}`));
    state = (await states().get("123456789")).state ?? state;
    expect((await customers().findById(merged.id))?.pointBalanceUnits).toBe(3_000_000);
    await processTelegramUpdate(context, callback(2003, `idsplit:${state.payload.token}`));
    current = (await states().get("123456789")).state;
    if (current === null) throw new Error("Missing preview.");
    failDisplay = true;
    await expect(processTelegramUpdate(context, callback(2004, `idsplitconfirm:${current.payload.token}`))).rejects.toThrow();
    expect((await states().get("123456789")).state?.payload.token).toBe(current.payload.token);
    expect(await rows("customers")).toHaveLength(2);
    failDisplay = false;
    await processTelegramUpdate(context, callback(2004, `idsplitconfirm:${current.payload.token}`));
    expect((await states().get("123456789")).state).toBeNull();
    expect(await rows("customers")).toHaveLength(2);
    expect(await rows("customer_split_receipts")).toHaveLength(1);
    expect(texts.at(-1)).toContain("Customer Split and Points Reset");
  });
});
