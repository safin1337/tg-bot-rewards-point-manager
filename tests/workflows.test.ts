import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { processTelegramUpdate } from "../src/application/bot-controller";
import { RewardMutationService } from "../src/application/mutation-service";
import { CustomerRepository } from "../src/database/customer-repository";
import { normalizePhone } from "../src/domain/phone";
import { readConfig } from "../src/env";
import type { TelegramUpdate } from "../src/telegram/types";
import { makeWorkflowContext } from "../src/workflows/context";

interface ApiCall {
  method: string;
  payload: Record<string, unknown> | null;
}

const calls: ApiCall[] = [];
let nextEditFailure: string | null = null;

const fakeFetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = url.split("/").at(-1) ?? "";
  let payload: Record<string, unknown> | null = null;
  if (typeof init?.body === "string") {
    const parsed: unknown = JSON.parse(init.body);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  }
  calls.push({ method, payload });
  if (method === "editMessageText" && nextEditFailure !== null) {
    const description = nextEditFailure;
    nextEditFailure = null;
    return Promise.resolve(new Response(JSON.stringify({ ok: false, description }), {
      status: 400,
      headers: { "content-type": "application/json" }
    }));
  }
  const result: unknown = method === "answerCallbackQuery"
    ? true
    : {
      message_id: typeof payload?.message_id === "number" ? payload.message_id : calls.length,
      chat: { id: typeof payload?.chat_id === "number" ? payload.chat_id : 123456789 }
    };
  return Promise.resolve(new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" }
  }));
}) as typeof fetch;

const message = (updateId: number, userId: number, text: string): TelegramUpdate => ({
  updateId,
  kind: "message",
  message: { message_id: updateId, from: { id: userId }, chat: { id: userId }, text }
});

const callback = (
  updateId: number,
  userId: number,
  data: string,
  messageId = updateId
): TelegramUpdate => ({
  updateId,
  kind: "callback",
  callbackQuery: {
    id: `callback-${updateId}`,
    from: { id: userId },
    data,
    message: { message_id: messageId, chat: { id: userId } }
  }
});

const callbackWithoutMessage = (updateId: number, userId: number, data: string): TelegramUpdate => ({
  updateId,
  kind: "callback",
  callbackQuery: { id: `callback-${updateId}`, from: { id: userId }, data, message: null }
});

beforeEach(async () => {
  calls.length = 0;
  nextEditFailure = null;
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

describe("administrator-only routing", () => {
  it("does not create state or disclose data to unauthorized messages", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(1, 999, "/purchase"));
    expect((await context.states.get("999")).state).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "sendMessage" });
    expect(String(calls[0]?.payload?.text)).toContain("restricted");
  });

  it("answers unauthorized callbacks without running the callback", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, callback(1, 999, "begin:P"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "answerCallbackQuery",
      payload: { callback_query_id: "callback-1", text: "Unauthorized" }
    });
    expect((await context.states.get("999")).state).toBeNull();
  });
});

describe("stateful customer search and purchase", () => {
  it("executes a suffix-selected purchase and prevents old search selection", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await new CustomerRepository(env.DB).createZeroBalance(
      normalizePhone("01712345678"),
      10,
      new Date().toISOString()
    );

    await processTelegramUpdate(context, message(11, 123456789, "/purchase"));
    const initial = (await context.states.get("123456789")).state;
    expect(initial?.currentStep).toBe("SELECT_MODE");

    await processTelegramUpdate(
      context,
      callback(12, 123456789, `mode:s:${initial?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(13, 123456789, "5678"));
    const searched = (await context.states.get("123456789")).state;
    expect(searched?.currentStep).toBe("SHOW_RESULTS");

    await processTelegramUpdate(
      context,
      callback(14, 123456789, `again:${searched?.payload.token ?? ""}`)
    );
    const reset = (await context.states.get("123456789")).state;
    expect(reset?.payload.token).not.toBe(searched?.payload.token);
    expect(reset).toMatchObject({ activeOperation: "PURCHASE", searchDigits: null, searchPage: 0 });

    await processTelegramUpdate(
      context,
      callback(15, 123456789, `sel:${searched?.payload.token ?? ""}:${created.customer.id}`)
    );
    expect((await context.states.get("123456789")).state?.selectedCustomerId).toBeNull();

    await processTelegramUpdate(context, message(16, 123456789, "5678"));
    const newSearch = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(17, 123456789, `sel:${newSearch?.payload.token ?? ""}:${created.customer.id}`)
    );
    expect((await context.states.get("123456789")).state?.currentStep).toBe("AWAIT_PURCHASE_AMOUNT");

    await processTelegramUpdate(context, message(18, 123456789, "525"));
    const confirmation = (await context.states.get("123456789")).state;
    expect(confirmation).toMatchObject({
      currentStep: "CONFIRM_PURCHASE",
      payload: { purchaseAmountBdt: 525, pointUnits: 65_625, expectedBalanceUnits: 0 }
    });

    await processTelegramUpdate(
      context,
      callback(19, 123456789, `confirm:${confirmation?.payload.token ?? ""}`)
    );
    expect((await context.states.get("123456789")).state).toBeNull();
    expect((await context.customers.findById(created.customer.id))?.pointBalanceUnits).toBe(65_625);
    const history = await context.transactions.listForCustomer(created.customer.id, 0);
    expect(history.transactions).toHaveLength(1);
    expect(history.transactions[0]).toMatchObject({
      transactionType: "PURCHASE",
      telegramUpdateId: 19
    });
    const purchaseSuccess = String(
      calls.find((call) => String(call.payload?.text).includes("Purchase Successfully Recorded"))?.payload?.text
    );
    const purchaseDisplay = calls.find((call) =>
      String(call.payload?.text).includes("Purchase Successfully Recorded")
    );
    expect(purchaseDisplay).toMatchObject({
      method: "editMessageText",
      payload: { message_id: 19, reply_markup: { inline_keyboard: [] } }
    });
    expect(purchaseSuccess).toContain("Points Earned: 6.5625 points");
    expect(purchaseSuccess).toContain("balance is 6.5625 points,\nwith a reward value of ≈ BDT 2.");
    expect(purchaseSuccess).toContain(
      "Buy More to Earn More\nThank you for purchasing from us\nBest Wishes from SoulShop"
    );

    await processTelegramUpdate(
      context,
      callback(19, 123456789, `confirm:${confirmation?.payload.token ?? ""}`)
    );
    expect((await context.customers.findById(created.customer.id))?.pointBalanceUnits).toBe(65_625);
    expect((await context.transactions.listForCustomer(created.customer.id, 0)).transactions).toHaveLength(1);
  });

  it("cancels and restarts without carrying collected values", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(20, 123456789, "/addpoints"));
    const first = (await context.states.get("123456789")).state;
    await processTelegramUpdate(context, message(21, 123456789, "/restart"));
    const restarted = (await context.states.get("123456789")).state;
    expect(restarted?.activeOperation).toBe("MANUAL_ADD");
    expect(restarted?.currentStep).toBe("SELECT_MODE");
    expect(restarted?.payload.token).not.toBe(first?.payload.token);

    await processTelegramUpdate(context, message(22, 123456789, "/cancel"));
    expect((await context.states.get("123456789")).state).toBeNull();
    expect(calls.some((call) => String(call.payload?.text).includes("cancelled"))).toBe(true);
  });

  it("answers malformed callback data without crashing or changing state", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(23, 123456789, "/redeem"));
    const before = (await context.states.get("123456789")).state;
    await processTelegramUpdate(context, callback(24, 123456789, "not:a:valid:callback"));
    const after = (await context.states.get("123456789")).state;
    expect(after?.payload.token).toBe(before?.payload.token);
    expect(calls.some((call) => call.method === "answerCallbackQuery")).toBe(true);
    expect(calls.some((call) => String(call.payload?.text).includes("malformed"))).toBe(true);
  });

  it("ignores delayed messages and callbacks from before the active operation", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(100, 123456789, "/purchase"));
    const initial = (await context.states.get("123456789")).state;
    expect(initial?.operationStartedUpdateId).toBe(100);

    await processTelegramUpdate(context, message(99, 123456789, "4567"));
    await processTelegramUpdate(context, callback(98, 123456789, "begin:M"));
    const current = (await context.states.get("123456789")).state;
    expect(current?.activeOperation).toBe("PURCHASE");
    expect(current?.currentStep).toBe("SELECT_MODE");
    expect(current?.payload.token).toBe(initial?.payload.token);
    expect(calls.filter((call) => String(call.payload?.text).includes("older Telegram update"))).toHaveLength(2);
  });

  it("searches exact last four digits and starts the selected purchase prompt correctly", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("+8801712344567"),
      110,
      new Date().toISOString()
    );
    await processTelegramUpdate(context, message(111, 123456789, "/purchase"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(context, callback(112, 123456789, `mode:s:${state?.payload.token ?? ""}`));
    await processTelegramUpdate(context, message(113, 123456789, "4567"));
    state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(114, 123456789, `sel:${state?.payload.token ?? ""}:${created.customer.id}`)
    );
    expect((await context.states.get("123456789")).state?.selectedCustomerId).toBe(created.customer.id);
    expect(calls.some((call) =>
      String(call.payload?.text).startsWith("✅ Taking entry for +8801712344567")
    )).toBe(true);
  });
});

describe("remaining end-to-end workflows", () => {
  it("registers a new customer at zero without creating reward history", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(30, 123456789, "/addcustomer"));
    await processTelegramUpdate(context, message(31, 123456789, "01712 345-678"));
    const confirmation = (await context.states.get("123456789")).state;
    expect(confirmation?.currentStep).toBe("CONFIRM_ADD_CUSTOMER");
    await processTelegramUpdate(
      context,
      callback(32, 123456789, `confirm:${confirmation?.payload.token ?? ""}`)
    );
    const customer = await context.customers.findByPhone("+8801712345678");
    expect(customer).toMatchObject({ pointBalanceUnits: 0, roundedRewardBdt: 0 });
    expect((await context.transactions.listForCustomer(customer?.id ?? 0, 0)).transactions).toHaveLength(0);
    expect((await context.customers.searchBySuffix("5678", 0)).customers.map((row) => row.id))
      .toContain(customer?.id);
    expect(calls.find((call) => String(call.payload?.text).includes("Customer Successfully Added")))
      .toMatchObject({
        method: "editMessageText",
        payload: { message_id: 32, reply_markup: { inline_keyboard: [] } }
      });
  });

  it("adds fractional points with an escaped optional note", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01712345678"),
      33,
      new Date().toISOString()
    );
    await processTelegramUpdate(context, message(34, 123456789, "/addpoints"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(context, callback(35, 123456789, `mode:f:${state?.payload.token ?? ""}`));
    await processTelegramUpdate(context, message(36, 123456789, "+880 1712-345678"));
    await processTelegramUpdate(context, message(37, 123456789, "1.25"));
    await processTelegramUpdate(context, message(38, 123456789, "<campaign>"));
    state = (await context.states.get("123456789")).state;
    expect(state?.currentStep).toBe("CONFIRM_MANUAL_ADD");
    await processTelegramUpdate(context, callback(39, 123456789, `confirm:${state?.payload.token ?? ""}`));
    expect((await context.customers.findById(created.customer.id))?.pointBalanceUnits).toBe(12_500);
    const history = await context.transactions.listForCustomer(created.customer.id, 0);
    expect(history.transactions[0]).toMatchObject({
      transactionType: "MANUAL_ADD",
      pointsDeltaUnits: 12_500,
      note: "<campaign>"
    });
    expect(calls.some((call) => String(call.payload?.text).includes("Reason: &lt;campaign&gt;"))).toBe(true);
    expect(calls.find((call) => String(call.payload?.text).includes("Points Successfully Added")))
      .toMatchObject({ method: "editMessageText", payload: { message_id: 39 } });
  });

  it("redeems fractional points and never sends Congratulations", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01712345678"),
      40,
      new Date().toISOString()
    );
    await new RewardMutationService(env.DB).mutate({
      customerId: created.customer.id,
      type: "MANUAL_ADD",
      pointUnits: 50_000,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 41,
      expectedBalanceUnits: 0
    });
    await processTelegramUpdate(context, message(42, 123456789, "/redeem"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(context, callback(43, 123456789, `mode:f:${state?.payload.token ?? ""}`));
    await processTelegramUpdate(context, message(44, 123456789, "01712345678"));
    await processTelegramUpdate(context, message(45, 123456789, "1.25"));
    state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(context, callback(46, 123456789, `confirm:${state?.payload.token ?? ""}`));
    expect((await context.customers.findById(created.customer.id))?.pointBalanceUnits).toBe(37_500);
    const success = calls.find((call) => String(call.payload?.text).includes("Successfully Redeemed"));
    expect(String(success?.payload?.text)).not.toContain("Congratulations");
    expect(success).toMatchObject({ method: "editMessageText", payload: { message_id: 46 } });
  });

  it("shows current balance and newest-first history through full-number selection", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01712345678"),
      50,
      new Date().toISOString()
    );
    await new RewardMutationService(env.DB).mutate({
      customerId: created.customer.id,
      type: "MANUAL_ADD",
      pointUnits: 10_000,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 51,
      expectedBalanceUnits: 0
    });
    await processTelegramUpdate(context, message(52, 123456789, "/balance"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(context, callback(53, 123456789, `mode:f:${state?.payload.token ?? ""}`));
    await processTelegramUpdate(context, message(54, 123456789, "01712345678"));
    expect(calls.some((call) => String(call.payload?.text).includes("Reward Point Balance"))).toBe(true);

    await processTelegramUpdate(context, message(55, 123456789, "/history"));
    state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(context, callback(56, 123456789, `mode:f:${state?.payload.token ?? ""}`));
    await processTelegramUpdate(context, message(57, 123456789, "01712345678"));
    expect(calls.some((call) => String(call.payload?.text).includes("Customer Reward History"))).toBe(true);
    expect((await context.states.get("123456789")).state?.currentStep).toBe("SHOW_HISTORY");
  });

  it("sends both complete-export documents once after Telegram accepts them", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await context.customers.createZeroBalance(
      normalizePhone("01712345678"),
      60,
      new Date().toISOString()
    );
    await processTelegramUpdate(context, message(61, 123456789, "/export"));
    const state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(context, callback(62, 123456789, `export:${state?.payload.token ?? ""}:a`));
    expect(calls.filter((call) => call.method === "sendDocument")).toHaveLength(2);
    expect(calls.some((call) => String(call.payload?.text).includes("Export sent successfully"))).toBe(true);
    expect((await context.states.get("123456789")).state).toBeNull();
  });
});

describe("administrator leaderboard workflow", () => {
  it("opens /leaderboard and displays weekly phone-only results", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01712345678"),
      700,
      new Date().toISOString()
    );
    await new RewardMutationService(env.DB).mutate({
      customerId: created.customer.id,
      type: "MANUAL_ADD",
      pointUnits: 12_500,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 701,
      expectedBalanceUnits: 0
    });

    await processTelegramUpdate(context, message(702, 123456789, "/leaderboard"));
    let state = (await context.states.get("123456789")).state;
    expect(state?.currentStep).toBe("LEADERBOARD_MENU");
    await processTelegramUpdate(
      context,
      callback(703, 123456789, `lb:w:${state?.payload.token ?? ""}`)
    );
    state = (await context.states.get("123456789")).state;
    expect(state?.currentStep).toBe("LEADERBOARD_WEEKLY");
    await processTelegramUpdate(
      context,
      callback(704, 123456789, `lbv:w:0:${state?.payload.token ?? ""}`)
    );
    const result = calls.find((call) => String(call.payload?.text).includes("SoulShop Weekly Leaderboard"));
    expect(String(result?.payload?.text)).toContain("+8801712345678 — 1.25 points");
    expect(String(result?.payload?.text)).not.toContain("Customer:");
    expect(result).toMatchObject({ method: "editMessageText", payload: { message_id: 704 } });
    await processTelegramUpdate(
      context,
      callback(705, 123456789, `lbv:w:0:${state?.payload.token ?? ""}`, 704)
    );
    const refreshed = calls.filter((call) =>
      call.method === "editMessageText"
      && String(call.payload?.text).includes("SoulShop Weekly Leaderboard")
    ).at(-1);
    expect(refreshed).toMatchObject({ method: "editMessageText", payload: { message_id: 704 } });
  });

  it("requires an authorized, current-token confirmation and makes repeated reset callbacks harmless", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01712345678"),
      710,
      new Date().toISOString()
    );
    await new RewardMutationService(env.DB).mutate({
      customerId: created.customer.id,
      type: "MANUAL_ADD",
      pointUnits: 10_000,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 711,
      expectedBalanceUnits: 0
    });
    await processTelegramUpdate(context, message(712, 123456789, "/leaderboard"));
    const menu = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(713, 123456789, `lbr:w:${menu?.payload.token ?? ""}`)
    );
    const confirmation = (await context.states.get("123456789")).state;
    expect(confirmation?.payload.token).not.toBe(menu?.payload.token);

    await processTelegramUpdate(
      context,
      callback(714, 123456789, `lbc:w:${menu?.payload.token ?? ""}`)
    );
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM leaderboard_reset_receipts")
      .first<{ count: number }>())?.count).toBe(0);

    await processTelegramUpdate(
      context,
      callback(715, 999, `lbc:w:${confirmation?.payload.token ?? ""}`)
    );
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM leaderboard_reset_receipts")
      .first<{ count: number }>())?.count).toBe(0);

    const validData = `lbc:w:${confirmation?.payload.token ?? ""}`;
    await processTelegramUpdate(context, callback(716, 123456789, validData));
    expect((await context.states.get("123456789")).state).toBeNull();
    const generation = await env.DB.prepare(
      "SELECT current_generation FROM leaderboard_periods WHERE period_type = 'WEEK'"
    ).first<{ current_generation: number }>();
    expect(generation?.current_generation).toBe(1);
    expect(calls.find((call) => String(call.payload?.text).includes("leaderboard reset successfully")))
      .toMatchObject({ method: "editMessageText", payload: { message_id: 716 } });

    await processTelegramUpdate(context, callback(716, 123456789, validData));
    const generationAfterReplay = await env.DB.prepare(
      "SELECT current_generation FROM leaderboard_periods WHERE period_type = 'WEEK'"
    ).first<{ current_generation: number }>();
    expect(generationAfterReplay?.current_generation).toBe(1);
  });
});

describe("active Telegram message behavior", () => {
  it("reuses one message ID for history Next and Previous", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01712345678"),
      20_000,
      new Date().toISOString()
    );
    let balance = 0;
    for (let index = 1; index <= 6; index += 1) {
      await new RewardMutationService(env.DB).mutate({
        customerId: created.customer.id,
        type: "MANUAL_ADD",
        pointUnits: 100,
        purchaseAmountBdt: null,
        note: null,
        telegramUpdateId: 20_000 + index,
        expectedBalanceUnits: balance
      });
      balance += 100;
    }
    await processTelegramUpdate(context, message(20_100, 123456789, "/history"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(20_101, 123456789, `mode:f:${state?.payload.token ?? ""}`, 500)
    );
    await processTelegramUpdate(context, message(20_102, 123456789, "01712345678"));
    state = (await context.states.get("123456789")).state;
    const token = state?.payload.token ?? "";
    await processTelegramUpdate(context, callback(20_103, 123456789, `hist:${token}:1`, 600));
    await processTelegramUpdate(context, callback(20_104, 123456789, `hist:${token}:0`, 600));
    const pageEdits = calls.filter((call) =>
      call.method === "editMessageText"
      && String(call.payload?.text).includes("Customer Reward History")
    );
    expect(pageEdits).toHaveLength(2);
    expect(pageEdits.map((call) => call.payload?.message_id)).toEqual([600, 600]);
  });

  it("reuses the search result message for pagination and Search Again", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    for (let index = 0; index < 9; index += 1) {
      await context.customers.createZeroBalance(
        normalizePhone(`+1415${String(index).padStart(6, "0")}4567`),
        21_000 + index,
        new Date().toISOString()
      );
    }
    await processTelegramUpdate(context, message(21_100, 123456789, "/balance"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(21_101, 123456789, `mode:s:${state?.payload.token ?? ""}`, 700)
    );
    await processTelegramUpdate(context, message(21_102, 123456789, "4567"));
    state = (await context.states.get("123456789")).state;
    const firstToken = state?.payload.token ?? "";
    await processTelegramUpdate(
      context,
      callback(21_103, 123456789, `pg:${firstToken}:1`, 701)
    );
    expect(calls.find((call) =>
      call.method === "editMessageText"
      && call.payload?.message_id === 701
      && String(call.payload.text).includes("Matching Customers")
    )).toBeDefined();
    await processTelegramUpdate(
      context,
      callback(21_104, 123456789, `again:${firstToken}`, 701)
    );
    const reset = (await context.states.get("123456789")).state;
    expect(reset?.payload.token).not.toBe(firstToken);
    expect(calls.find((call) =>
      call.method === "editMessageText"
      && call.payload?.message_id === 701
      && String(call.payload.text).includes("Enter the last 4 or 5 digits")
    )).toBeDefined();
  });

  it("answers first, edits button prompts, then sends after typed input for chronological order", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(22_000, 123456789, "/balance"));
    const state = (await context.states.get("123456789")).state;
    calls.length = 0;
    await processTelegramUpdate(
      context,
      callback(22_001, 123456789, `mode:s:${state?.payload.token ?? ""}`, 702)
    );
    expect(calls[0]?.method).toBe("answerCallbackQuery");
    expect(calls[1]).toMatchObject({ method: "editMessageText", payload: { message_id: 702 } });
    calls.length = 0;
    await processTelegramUpdate(context, message(22_002, 123456789, "9999"));
    expect(calls.some((call) => call.method === "sendMessage")).toBe(true);
    expect(calls.some((call) => call.method === "editMessageText")).toBe(false);
    const noMatch = (await context.states.get("123456789")).state;
    calls.length = 0;
    await processTelegramUpdate(
      context,
      callback(22_003, 123456789, `again:${noMatch?.payload.token ?? ""}`, 703)
    );
    expect(calls.find((call) => call.method === "editMessageText"))
      .toMatchObject({ payload: { message_id: 703 } });
  });

  it("replaces a callback panel with its cancellation result", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(22_100, 123456789, "/redeem"));
    calls.length = 0;
    await processTelegramUpdate(context, callback(22_101, 123456789, "cancel", 710));
    expect((await context.states.get("123456789")).state).toBeNull();
    expect(calls.find((call) => String(call.payload?.text).includes("operation was cancelled")))
      .toMatchObject({ method: "editMessageText", payload: { message_id: 710 } });
  });

  it("treats message-is-not-modified as harmless without sending a replacement", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(23_000, 123456789, "/purchase"));
    const state = (await context.states.get("123456789")).state;
    calls.length = 0;
    nextEditFailure = "Bad Request: message is not modified";
    await processTelegramUpdate(
      context,
      callback(23_001, 123456789, `mode:s:${state?.payload.token ?? ""}`, 703)
    );
    expect(calls.map((call) => call.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
    expect((await context.states.get("123456789")).state?.currentStep).toBe("AWAIT_SEARCH");
  });

  it("falls back once after a committed mutation edit failure and never repeats the mutation", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01712345678"),
      24_000,
      new Date().toISOString()
    );
    await processTelegramUpdate(context, message(24_100, 123456789, "/purchase"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(24_101, 123456789, `mode:f:${state?.payload.token ?? ""}`, 704)
    );
    await processTelegramUpdate(context, message(24_102, 123456789, "01712345678"));
    await processTelegramUpdate(context, message(24_103, 123456789, "80"));
    state = (await context.states.get("123456789")).state;
    const confirmationData = `confirm:${state?.payload.token ?? ""}`;
    calls.length = 0;
    nextEditFailure = "Bad Request: message to edit not found";
    await processTelegramUpdate(context, callback(24_104, 123456789, confirmationData, 705));
    expect(calls.filter((call) => call.method === "editMessageText")).toHaveLength(1);
    expect(calls.filter((call) =>
      call.method === "sendMessage"
      && String(call.payload?.text).includes("Purchase Successfully Recorded")
    )).toHaveLength(1);
    expect((await context.customers.findById(created.customer.id))?.pointBalanceUnits).toBe(10_000);
    await processTelegramUpdate(context, callback(24_104, 123456789, confirmationData, 705));
    expect((await context.transactions.listForCustomer(created.customer.id, 0)).transactions)
      .toHaveLength(1);
  });

  it("uses a safe send fallback when a callback has no accessible message", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(25_000, 123456789, "/balance"));
    const state = (await context.states.get("123456789")).state;
    calls.length = 0;
    await processTelegramUpdate(
      context,
      callbackWithoutMessage(25_001, 123456789, `mode:s:${state?.payload.token ?? ""}`)
    );
    expect(calls[0]?.method).toBe("answerCallbackQuery");
    expect(calls[1]).toMatchObject({
      method: "sendMessage",
      payload: { chat_id: 123456789 }
    });
  });
});
