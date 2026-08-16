import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { processTelegramUpdate } from "../src/application/bot-controller";
import { RewardMutationService } from "../src/application/mutation-service";
import { CustomerRepository } from "../src/database/customer-repository";
import { normalizePhone } from "../src/domain/phone";
import { EARNING_POLICY_ID } from "../src/domain/rewards";
import { readConfig } from "../src/env";
import { parseTelegramUpdate, type TelegramUpdate } from "../src/telegram/types";
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

const nonTextMessage = (updateId: number, userId: number): TelegramUpdate => ({
  updateId,
  kind: "non_text_message",
  message: { message_id: updateId, from: { id: userId }, chat: { id: userId } }
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

  it("does not expose workflow or customer data to unauthorized non-text messages", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, nonTextMessage(2, 999));
    expect((await context.states.get("999")).state).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "sendMessage", payload: { chat_id: 999 } });
    expect(String(calls[0]?.payload?.text)).toContain("restricted");
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM processed_updates")
      .first<{ count: number }>())?.count).toBe(0);
  });
});

describe("non-text message isolation", () => {
  it("preserves identifier input state, ignores a caption, and accepts the next valid text", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01700000001"),
      30_000,
      new Date().toISOString()
    );
    await processTelegramUpdate(context, message(30_001, 123456789, "/purchase"));
    const initialState = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(30_002, 123456789, `mode:f:${initialState?.payload.token ?? ""}`)
    );
    const before = (await context.states.get("123456789")).state;
    calls.length = 0;

    const parsed = parseTelegramUpdate({
      update_id: 30_003,
      message: {
        message_id: 30_003,
        from: { id: 123456789 },
        chat: { id: 123456789 },
        caption: "/cancel",
        photo: [{ fixture: true }]
      }
    });
    if (parsed.disposition !== "process") throw new Error("Fixture media update was not parsed.");
    await processTelegramUpdate(context, parsed.update);

    expect((await context.states.get("123456789")).state).toEqual(before);
    expect(calls).toEqual([{
      method: "sendMessage",
      payload: {
        chat_id: 123456789,
        text: "🏆 <b>SoulShop Rewards Point System</b>\n\n⚠️ Images and other non-text messages are not supported. Please send text, use the available buttons, or use /cancel.",
        parse_mode: "HTML"
      }
    }]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM processed_updates")
      .first<{ count: number }>())?.count).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM transactions")
      .first<{ count: number }>())?.count).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM mutation_receipts")
      .first<{ count: number }>())?.count).toBe(0);
    expect((await context.customers.findById(created.customer.id))?.pointBalanceUnits).toBe(0);

    await processTelegramUpdate(context, message(30_004, 123456789, "01700000001"));
    const afterValidText = (await context.states.get("123456789")).state;
    expect(afterValidText).toMatchObject({
      activeOperation: "PURCHASE",
      currentStep: "AWAIT_PURCHASE_AMOUNT",
      selectedCustomerId: created.customer.id,
      operationStartedUpdateId: 30_001
    });
  });

  it("preserves selected-customer state and balance while waiting for an amount", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01700000002"),
      31_000,
      new Date().toISOString()
    );
    await processTelegramUpdate(context, message(31_001, 123456789, "/purchase"));
    const state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(31_002, 123456789, `mode:f:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(31_003, 123456789, "01700000002"));
    const before = (await context.states.get("123456789")).state;
    const customerBefore = await context.customers.findById(created.customer.id);

    await processTelegramUpdate(context, nonTextMessage(31_004, 123456789));

    expect((await context.states.get("123456789")).state).toEqual(before);
    expect(await context.customers.findById(created.customer.id)).toEqual(customerBefore);
    expect((await context.transactions.listForCustomer(created.customer.id, 0)).transactions)
      .toHaveLength(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM leaderboard_aggregates")
      .first<{ count: number }>())?.count).toBe(0);
    await processTelegramUpdate(context, message(31_005, 123456789, "500"));
    expect((await context.states.get("123456789")).state).toMatchObject({
      currentStep: "CONFIRM_PURCHASE",
      selectedCustomerId: created.customer.id
    });
  });

  it.each(["/start", "/cancel", "/restart", "/purchase"] as const)(
    "allows %s immediately after a non-text message",
    async (command) => {
      const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
      await processTelegramUpdate(context, message(32_000, 123456789, "/purchase"));
      const before = (await context.states.get("123456789")).state;
      await processTelegramUpdate(context, nonTextMessage(32_001, 123456789));
      expect((await context.states.get("123456789")).state).toEqual(before);

      await processTelegramUpdate(context, message(32_002, 123456789, command));
      const after = (await context.states.get("123456789")).state;
      if (command === "/start" || command === "/cancel") {
        expect(after).toBeNull();
      } else {
        expect(after).toMatchObject({
          activeOperation: "PURCHASE",
          currentStep: "SELECT_MODE",
          operationStartedUpdateId: 32_002
        });
        expect(after?.payload.token).not.toBe(before?.payload.token);
      }
    }
  );

  it("keeps a newer operation intact when an older non-text update arrives", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(33_100, 123456789, "/purchase"));
    const before = (await context.states.get("123456789")).state;
    calls.length = 0;

    await processTelegramUpdate(context, nonTextMessage(33_099, 123456789));

    expect((await context.states.get("123456789")).state).toEqual(before);
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.payload?.text)).toContain("non-text messages are not supported");
  });
});

describe("stateful customer search and purchase", () => {
  it.each([
    ["P", "PURCHASE", "🛍️ <b>Record Purchase</b>"],
    ["M", "MANUAL_ADD", "➕ <b>Add Points Manually</b>"],
    ["R", "REDEEM", "🎁 <b>Redeem Points</b>"],
    ["B", "BALANCE", "💰 <b>Check Balance</b>"],
    ["H", "HISTORY", "📜 <b>Customer History</b>"]
  ] as const)(
    "shows the active %s operation on the dashboard customer-selection panel",
    async (code, operation, heading) => {
      const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);

      await processTelegramUpdate(context, callback(5, 123456789, `begin:${code}`, 50));

      expect((await context.states.get("123456789")).state).toMatchObject({
        activeOperation: operation,
        currentStep: "SELECT_MODE"
      });
      const selectionCall = calls.find((call) => call.method === "editMessageText");
      expect(selectionCall?.payload).toMatchObject({
        message_id: 50,
        text: `🏆 <b>SoulShop Rewards Point System</b>\n\n${heading}\n\nSelect a customer:`
      });
    }
  );

  it.each([
    [
      "s",
      "Selected Operation: 🛍️ Record Purchase\n\n"
      + "Enter the last 4 or 5 digits of the WhatsApp No.\n"
      + "Telegram / WhatsApp Username are not accepted"
    ],
    [
      "f",
      "Selected Operation: 🛍️ Record Purchase\n\n"
      + "Enter the customer's WhatsApp number:\n"
      + "Spaces and hyphen are accepted."
    ],
    [
      "w",
      "Selected Operation: 🛍️ Record Purchase\n\n"
      + "Enter the customer's WhatsApp username:"
    ],
    [
      "t",
      "Selected Operation: 🛍️ Record Purchase\n\n"
      + "Enter the customer's Telegram username:"
    ]
  ] as const)("shows the selected operation on the %s identifier prompt", async (mode, expectedText) => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(6, 123456789, "/purchase"));
    const state = (await context.states.get("123456789")).state;
    calls.length = 0;

    await processTelegramUpdate(
      context,
      callback(7, 123456789, `mode:${mode}:${state?.payload.token ?? ""}`, 51)
    );
    const promptState = (await context.states.get("123456789")).state;

    expect(calls[0]?.method).toBe("answerCallbackQuery");
    expect(calls[1]).toMatchObject({
      method: "editMessageText",
      payload: {
        message_id: 51,
        text: expectedText,
        reply_markup: {
          inline_keyboard: [
            [{ text: "⬅️ Back", callback_data: `back:s:${promptState?.payload.token ?? ""}` }],
            [{ text: "❌ Cancel", callback_data: "cancel" }]
          ]
        }
      }
    });
  });

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
    expect(reset).toMatchObject({ activeOperation: "PURCHASE", searchQuery: null, searchPage: 0 });

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
    expect(calls.some((call) => String(call.payload?.text).includes(
      "Latest Transaction:\nNo Prior Data Found!\n\nEnter the purchase amount in BDT."
    ))).toBe(true);

    await processTelegramUpdate(context, message(18, 123456789, "500"));
    const confirmation = (await context.states.get("123456789")).state;
    expect(confirmation).toMatchObject({
      currentStep: "CONFIRM_PURCHASE",
      payload: {
        purchaseAmountBdt: 500,
        pointUnits: 100_000,
        earningPolicyId: EARNING_POLICY_ID,
        expectedBalanceUnits: 0
      }
    });

    await processTelegramUpdate(
      context,
      callback(19, 123456789, `confirm:${confirmation?.payload.token ?? ""}`)
    );
    expect((await context.states.get("123456789")).state).toBeNull();
    expect((await context.customers.findById(created.customer.id))?.pointBalanceUnits).toBe(100_000);
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
    expect(purchaseSuccess).toContain("Points Earned: 10.00 points");
    expect(purchaseSuccess).toContain(
      "Your updated reward balance: 10.00 points\nEstimated reward value: BDT 3"
    );
    expect(purchaseSuccess).toContain(
      "Buy More to Earn More\nThank you for purchasing from us\nBest Wishes from SoulShop"
    );

    await processTelegramUpdate(
      context,
      callback(19, 123456789, `confirm:${confirmation?.payload.token ?? ""}`)
    );
    expect((await context.customers.findById(created.customer.id))?.pointBalanceUnits).toBe(100_000);
    expect((await context.transactions.listForCustomer(created.customer.id, 0)).transactions).toHaveLength(1);
  });

  it("shows the latest purchase on Record Purchase while skipping a newer redemption", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01777622294"),
      200,
      "2026-08-10T12:00:00.000Z"
    );
    await new RewardMutationService(
      env.DB,
      () => new Date("2026-08-10T12:27:00.000Z")
    ).mutate({
      customerId: created.customer.id,
      type: "PURCHASE",
      pointUnits: 110_000,
      purchaseAmountBdt: 550,
      note: null,
      telegramUpdateId: 201,
      expectedBalanceUnits: 0
    });
    await new RewardMutationService(
      env.DB,
      () => new Date("2026-08-11T10:11:00.000Z")
    ).mutate({
      customerId: created.customer.id,
      type: "REDEEM",
      pointUnits: 10_000,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 202,
      expectedBalanceUnits: 110_000
    });

    await processTelegramUpdate(context, message(203, 123456789, "/purchase"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(204, 123456789, `mode:f:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(205, 123456789, "01777622294"));

    const amountPrompt = calls.filter((call) =>
      String(call.payload?.text).includes("Enter the purchase amount in BDT.")
    ).at(-1);
    expect(amountPrompt?.payload?.text).toBe(
      "✅ <b>Taking entry for +8801777622294</b>\n\n"
      + "Latest Transaction:\n"
      + "<b>10 Aug 2026, 06:27 PM</b>\n"
      + "PURCHASE: +11.00 points\n"
      + "Purchase Amount: BDT 550\n\n"
      + "Enter the purchase amount in BDT."
    );
    state = (await context.states.get("123456789")).state;
    expect(state?.currentStep).toBe("AWAIT_PURCHASE_AMOUNT");
  });

  it("shows the latest manual addition and escaped reason on Add Points", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01777622294"),
      210,
      "2026-08-10T12:00:00.000Z"
    );
    await new RewardMutationService(
      env.DB,
      () => new Date("2026-08-10T12:27:00.000Z")
    ).mutate({
      customerId: created.customer.id,
      type: "MANUAL_ADD",
      pointUnits: 110_000,
      purchaseAmountBdt: null,
      note: "<campaign & bonus>",
      telegramUpdateId: 211,
      expectedBalanceUnits: 0
    });
    await new RewardMutationService(
      env.DB,
      () => new Date("2026-08-11T10:11:00.000Z")
    ).mutate({
      customerId: created.customer.id,
      type: "REDEEM",
      pointUnits: 10_000,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 212,
      expectedBalanceUnits: 110_000
    });

    await processTelegramUpdate(context, message(213, 123456789, "/addpoints"));
    const state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(214, 123456789, `mode:f:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(215, 123456789, "01777622294"));

    const amountPrompt = calls.filter((call) =>
      String(call.payload?.text).includes("Enter the number of points you want to add.")
    ).at(-1);
    expect(amountPrompt?.payload?.text).toBe(
      "✅ <b>Taking entry for +8801777622294</b>\n\n"
      + "Latest Transaction:\n"
      + "<b>10 Aug 2026, 06:27 PM</b>\n"
      + "MANUAL_ADD: +11.00 points\n"
      + "Reason: &lt;campaign &amp; bonus&gt;\n\n"
      + "Enter the number of points you want to add."
    );
    expect((await context.states.get("123456789")).state?.currentStep).toBe("AWAIT_POINT_AMOUNT");
  });

  it.each([
    ["missing", null],
    ["different", "earning:80:1:125"]
  ] as const)("rejects a purchase confirmation with a %s earning policy identifier", async (_label, policyId) => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01712345678"),
      80,
      new Date().toISOString()
    );
    const started = await context.states.start("123456789", "PURCHASE", "CONFIRM_PURCHASE", 81);
    const staleConfirmation = await context.states.save({
      ...started,
      selectedCustomerId: created.customer.id,
      payload: {
        token: started.payload.token,
        purchaseAmountBdt: 80,
        pointUnits: 10_000,
        ...(policyId === null ? {} : { earningPolicyId: policyId }),
        expectedBalanceUnits: 0
      }
    });

    await processTelegramUpdate(
      context,
      callback(82, 123456789, `confirm:${staleConfirmation.payload.token}`)
    );

    expect((await context.states.get("123456789")).state).toBeNull();
    expect((await context.customers.findById(created.customer.id))?.pointBalanceUnits).toBe(0);
    expect((await context.transactions.listForCustomer(created.customer.id, 0)).transactions).toHaveLength(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM mutation_receipts")
      .first<{ count: number }>())?.count).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM leaderboard_aggregates")
      .first<{ count: number }>())?.count).toBe(0);
    expect(calls.some((call) => call.method === "answerCallbackQuery")).toBe(true);
    const rejection = calls.find((call) => String(call.payload?.text).includes("reward policy changed"));
    expect(rejection).toMatchObject({
      method: "editMessageText",
      payload: { message_id: 82 }
    });
    expect(String(rejection?.payload?.text)).toContain("restart the purchase from the dashboard");
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
      String(call.payload?.text).startsWith(
        "✅ <b>Taking entry for +8801712344567</b>\n\nLatest Transaction:\nNo Prior Data Found!"
      )
    )).toBe(true);
  });

  it.each([
    ["s", "AWAIT_SEARCH"],
    ["f", "AWAIT_FULL_NUMBER"]
  ] as const)("returns from %s customer input to Search Options with a fresh token", async (mode, step) => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(120, 123456789, "/purchase"));
    const initial = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(121, 123456789, `mode:${mode}:${initial?.payload.token ?? ""}`, 800)
    );
    const input = (await context.states.get("123456789")).state;
    expect(input?.currentStep).toBe(step);

    calls.length = 0;
    await processTelegramUpdate(
      context,
      callback(122, 123456789, `back:s:${input?.payload.token ?? ""}`, 800)
    );
    const returned = (await context.states.get("123456789")).state;
    expect(returned).toMatchObject({
      activeOperation: "PURCHASE",
      currentStep: "SELECT_MODE",
      selectionMode: null,
      selectedCustomerId: null,
      searchQuery: null,
      searchPage: 0
    });
    expect(returned?.payload.token).not.toBe(input?.payload.token);
    expect(calls[0]?.method).toBe("answerCallbackQuery");
    expect(calls[1]).toMatchObject({
      method: "editMessageText",
      payload: { message_id: 800 }
    });
    expect(String(calls[1]?.payload?.text)).toContain("Select a customer:");

    await processTelegramUpdate(
      context,
      callback(123, 123456789, `back:s:${input?.payload.token ?? ""}`, 800)
    );
    expect((await context.states.get("123456789")).state?.payload.token).toBe(returned?.payload.token);
    expect(calls.some((call) => String(call.payload?.text).includes("button is stale"))).toBe(true);
  });

  it("returns from search results and clears the completed suffix search", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await context.customers.createZeroBalance(normalizePhone("01712345678"), 130, new Date().toISOString());
    await processTelegramUpdate(context, message(131, 123456789, "/balance"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(context, callback(132, 123456789, `mode:s:${state?.payload.token ?? ""}`));
    await processTelegramUpdate(context, message(133, 123456789, "5678"));
    state = (await context.states.get("123456789")).state;
    expect(state).toMatchObject({ currentStep: "SHOW_RESULTS", searchQuery: "5678" });

    await processTelegramUpdate(
      context,
      callback(134, 123456789, `back:s:${state?.payload.token ?? ""}`, 801)
    );
    expect((await context.states.get("123456789")).state).toMatchObject({
      activeOperation: "BALANCE",
      currentStep: "SELECT_MODE",
      searchQuery: null,
      searchPage: 0
    });
  });

  it("backs out of purchase confirmation without mutating and invalidates the old Confirm button", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01712345678"),
      140,
      new Date().toISOString()
    );
    await processTelegramUpdate(context, message(141, 123456789, "/purchase"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(context, callback(142, 123456789, `mode:f:${state?.payload.token ?? ""}`));
    await processTelegramUpdate(context, message(143, 123456789, "01712345678"));
    await processTelegramUpdate(context, message(144, 123456789, "500"));
    state = (await context.states.get("123456789")).state;
    const confirmationToken = state?.payload.token ?? "";
    expect(state?.currentStep).toBe("CONFIRM_PURCHASE");

    await processTelegramUpdate(context, callback(145, 123456789, `back:a:${confirmationToken}`, 802));
    const amount = (await context.states.get("123456789")).state;
    expect(amount).toMatchObject({
      activeOperation: "PURCHASE",
      currentStep: "AWAIT_PURCHASE_AMOUNT",
      selectedCustomerId: created.customer.id
    });
    expect(amount?.payload).toEqual({ token: amount?.payload.token });
    expect(amount?.payload.token).not.toBe(confirmationToken);

    await processTelegramUpdate(context, callback(146, 123456789, `confirm:${confirmationToken}`, 802));
    expect((await context.customers.findById(created.customer.id))?.pointBalanceUnits).toBe(0);
    expect((await context.transactions.listForCustomer(created.customer.id, 0)).transactions).toHaveLength(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM mutation_receipts")
      .first<{ count: number }>())?.count).toBe(0);
  });

  it("backs from manual-add confirmation to note and then to point amount", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01712345678"),
      150,
      new Date().toISOString()
    );
    await processTelegramUpdate(context, message(151, 123456789, "/addpoints"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(context, callback(152, 123456789, `mode:f:${state?.payload.token ?? ""}`));
    await processTelegramUpdate(context, message(153, 123456789, "01712345678"));
    await processTelegramUpdate(context, message(154, 123456789, "1.25"));
    await processTelegramUpdate(context, message(155, 123456789, "campaign"));
    state = (await context.states.get("123456789")).state;
    const confirmationToken = state?.payload.token ?? "";

    await processTelegramUpdate(context, callback(156, 123456789, `back:n:${confirmationToken}`, 803));
    const note = (await context.states.get("123456789")).state;
    expect(note).toMatchObject({
      currentStep: "AWAIT_NOTE",
      selectedCustomerId: created.customer.id,
      payload: { pointUnits: 12_500, expectedBalanceUnits: 0 }
    });
    expect(note?.payload.note).toBeUndefined();
    expect(note?.payload.token).not.toBe(confirmationToken);

    await processTelegramUpdate(
      context,
      callback(157, 123456789, `back:a:${note?.payload.token ?? ""}`, 803)
    );
    const amount = (await context.states.get("123456789")).state;
    expect(amount).toMatchObject({
      currentStep: "AWAIT_POINT_AMOUNT",
      selectedCustomerId: created.customer.id
    });
    expect(amount?.payload).toEqual({ token: amount?.payload.token });
    expect((await context.customers.findById(created.customer.id))?.pointBalanceUnits).toBe(0);
    expect((await context.transactions.listForCustomer(created.customer.id, 0)).transactions).toHaveLength(0);
  });
});

describe("remaining end-to-end workflows", () => {
  it("backs out of customer creation without creating a customer", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(26, 123456789, "/purchase"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(context, callback(27, 123456789, `mode:f:${state?.payload.token ?? ""}`));
    await processTelegramUpdate(context, message(28, 123456789, "01712345678"));
    state = (await context.states.get("123456789")).state;
    const createToken = state?.payload.token ?? "";
    expect(state?.currentStep).toBe("CONFIRM_CREATE_FOR_OPERATION");

    await processTelegramUpdate(context, callback(29, 123456789, `back:f:${createToken}`, 804));
    const returned = (await context.states.get("123456789")).state;
    expect(returned).toMatchObject({
      activeOperation: "PURCHASE",
      currentStep: "AWAIT_FULL_NUMBER",
      selectionMode: "PHONE_FULL",
      selectedCustomerId: null
    });
    expect(returned?.payload).toEqual({ token: returned?.payload.token });
    expect(returned?.payload.token).not.toBe(createToken);

    await processTelegramUpdate(context, callback(30, 123456789, `create:${createToken}`, 804));
    expect(await context.customers.findByPhone("+8801712345678")).toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM mutation_receipts")
      .first<{ count: number }>())?.count).toBe(0);
  });

  it("registers a new customer at zero without creating reward history", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(30, 123456789, "/addcustomer"));
    const state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(31, 123456789, `newid:p:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(32, 123456789, "01712 345-678"));
    const confirmation = (await context.states.get("123456789")).state;
    expect(confirmation?.currentStep).toBe("CONFIRM_ADD_CUSTOMER");
    await processTelegramUpdate(
      context,
      callback(33, 123456789, `confirm:${confirmation?.payload.token ?? ""}`)
    );
    const customer = await context.customers.findByPhone("+8801712345678");
    expect(customer).toMatchObject({ pointBalanceUnits: 0, roundedRewardBdt: 0 });
    expect((await context.transactions.listForCustomer(customer?.id ?? 0, 0)).transactions).toHaveLength(0);
    expect((await context.customers.searchBySuffix("5678", 0)).customers.map((row) => row.id))
      .toContain(customer?.id);
    expect(calls.find((call) => String(call.payload?.text).includes("Customer Successfully Added")))
      .toMatchObject({
        method: "editMessageText",
        payload: { message_id: 33, reply_markup: { inline_keyboard: [] } }
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

  it("redeems the exact stored balance through Redeem All Points after confirmation", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01332391100"),
      47,
      new Date().toISOString()
    );
    const exactBalanceUnits = 13_006_965;
    await context.mutations.mutate({
      customerId: created.customer.id,
      type: "MANUAL_ADD",
      pointUnits: exactBalanceUnits,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 48,
      expectedBalanceUnits: 0
    });

    await processTelegramUpdate(context, message(49, 123456789, "/redeem"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(50, 123456789, `mode:f:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(51, 123456789, "01332391100"));
    state = (await context.states.get("123456789")).state;

    const amountPrompt = calls.filter((call) =>
      String(call.payload?.text).includes("Enter the number of points you want to redeem")
    ).at(-1);
    expect(amountPrompt?.payload?.reply_markup).toEqual({
      inline_keyboard: [[{
        text: "💯 Redeem All Points",
        callback_data: `redeemall:${state?.payload.token ?? ""}`
      }], [{
        text: "⬅️ Back to Customer Search",
        callback_data: `back:s:${state?.payload.token ?? ""}`
      }], [{ text: "❌ Cancel", callback_data: "cancel" }]]
    });

    await processTelegramUpdate(
      context,
      callback(52, 123456789, `redeemall:${state?.payload.token ?? ""}`)
    );
    state = (await context.states.get("123456789")).state;
    expect(state).toMatchObject({
      currentStep: "CONFIRM_REDEEM",
      payload: {
        pointUnits: exactBalanceUnits,
        expectedBalanceUnits: exactBalanceUnits
      }
    });
    const confirmation = calls.filter((call) =>
      String(call.payload?.text).includes("Confirm Redemption")
    ).at(-1);
    expect(String(confirmation?.payload?.text)).toContain("Points to Redeem: 1,300.70 points");
    expect(String(confirmation?.payload?.text)).toContain("New Points: 0.00 points");

    await processTelegramUpdate(
      context,
      callback(53, 123456789, `confirm:${state?.payload.token ?? ""}`)
    );
    expect((await context.customers.findById(created.customer.id))?.pointBalanceUnits).toBe(0);
    expect((await context.states.get("123456789")).state).toBeNull();
    const history = await context.transactions.listForCustomer(created.customer.id, 0);
    expect(history.transactions[0]).toMatchObject({
      transactionType: "REDEEM",
      pointsDeltaUnits: -exactBalanceUnits,
      balanceAfterUnits: 0
    });
    const success = calls.filter((call) =>
      String(call.payload?.text).includes("Reward Points Successfully Redeemed")
    ).at(-1);
    expect(String(success?.payload?.text)).toContain("Your remaining reward balance: 0.00 points");
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

describe("multi-identifier workflows", () => {
  it.each([
    ["p", "Enter the customer's WhatsApp number:\nSpaces and hyphen are accepted."],
    ["w", "Enter the customer's WhatsApp username:"],
    ["t", "Enter the customer's Telegram username:"]
  ] as const)("uses the standardized Add Customer %s prompt", async (code, instruction) => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(290, 123456789, "/addcustomer"));
    const state = (await context.states.get("123456789")).state;

    await processTelegramUpdate(
      context,
      callback(291, 123456789, `newid:${code}:${state?.payload.token ?? ""}`, 900)
    );

    const prompt = calls.find((call) =>
      call.method === "editMessageText" && call.payload?.message_id === 900
    );
    expect(String(prompt?.payload?.text))
      .toContain(`➕ <b>Add New Customer</b>\n\n${instruction}`);
  });

  it.each([
    ["w", "WHATSAPP_USERNAME", "invalid\u200Bname", "\u2066@Example.Name\u2069", "Example.Name"],
    ["t", "TELEGRAM_USERNAME", "invalid.name", "\u2066@Example_Name\u2069", "Example_Name"]
  ] as const)(
    "accepts a valid %s username immediately after invalid input without restart",
    async (code, type, invalid, valid, expected) => {
      const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
      await processTelegramUpdate(context, message(292, 123456789, "/addcustomer"));
      let state = (await context.states.get("123456789")).state;
      await processTelegramUpdate(
        context,
        callback(293, 123456789, `newid:${code}:${state?.payload.token ?? ""}`)
      );
      state = (await context.states.get("123456789")).state;
      const inputToken = state?.payload.token;

      await processTelegramUpdate(context, message(294, 123456789, invalid));
      expect((await context.states.get("123456789")).state).toMatchObject({
        currentStep: "AWAIT_ADD_CUSTOMER_IDENTITY",
        payload: { token: inputToken, pendingIdentifierType: type }
      });

      await processTelegramUpdate(context, message(295, 123456789, valid));
      expect((await context.states.get("123456789")).state).toMatchObject({
        currentStep: "CONFIRM_ADD_CUSTOMER",
        payload: { pendingIdentifierType: type, pendingIdentifierValue: expected }
      });
      expect(calls.some((call) => String(call.payload?.text).includes(
        `${type === "WHATSAPP_USERNAME" ? "WhatsApp" : "Telegram"} Username: @${expected}`
      ))).toBe(true);
    }
  );

  it.each([
    ["p", "Enter the customer's WhatsApp number:\nSpaces and hyphen are accepted."],
    ["w", "Enter the customer's WhatsApp username:"],
    ["t", "Enter the customer's Telegram username:"]
  ] as const)("uses the standardized Manage Customer %s prompt", async (code, instruction) => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await context.customers.createZeroBalance(
      normalizePhone("01712345678"),
      296,
      "2026-08-16T06:00:00.000Z"
    );
    await processTelegramUpdate(context, message(297, 123456789, "/managecustomer"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(298, 123456789, `mode:f:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(299, 123456789, "01712345678"));
    state = (await context.states.get("123456789")).state;
    calls.length = 0;

    await processTelegramUpdate(
      context,
      callback(300, 123456789, `idedit:${code}:${state?.payload.token ?? ""}`, 901)
    );

    expect(calls[1]).toMatchObject({
      method: "editMessageText",
      payload: { message_id: 901 }
    });
    expect(String(calls[1]?.payload?.text))
      .toContain(`\n\n${instruction}\n\nCurrent Value:`);
  });

  it("creates a username-only customer and finds it case-insensitively while preserving display case", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(300, 123456789, "/addcustomer"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(301, 123456789, `newid:w:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(302, 123456789, "@Safin_Ahmed"));
    state = (await context.states.get("123456789")).state;
    expect(state).toMatchObject({
      currentStep: "CONFIRM_ADD_CUSTOMER",
      payload: {
        pendingIdentifierType: "WHATSAPP_USERNAME",
        pendingIdentifierValue: "Safin_Ahmed"
      }
    });
    await processTelegramUpdate(
      context,
      callback(303, 123456789, `confirm:${state?.payload.token ?? ""}`)
    );

    const customer = await context.customers.findByWhatsappUsername("safin_ahmed");
    expect(customer).toMatchObject({
      whatsappNumber: null,
      whatsappUsername: "Safin_Ahmed",
      telegramUsername: null,
      pointBalanceUnits: 0
    });

    await processTelegramUpdate(context, message(304, 123456789, "/balance"));
    state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(305, 123456789, `mode:w:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(306, 123456789, "SAFIN_AHMED"));

    expect((await context.states.get("123456789")).state).toBeNull();
    expect(calls.some((call) => String(call.payload?.text).includes(
      "Customer Info:\nWhatsApp Username: @Safin_Ahmed"
    ))).toBe(true);
  });

  it("adds and changes aliases without changing balance or history", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01712345678"),
      310,
      "2026-08-14T06:10:00.000Z"
    );
    await new RewardMutationService(env.DB).mutate({
      customerId: created.customer.id,
      type: "MANUAL_ADD",
      pointUnits: 45_000,
      purchaseAmountBdt: null,
      note: null,
      telegramUpdateId: 311,
      expectedBalanceUnits: 0
    });

    await processTelegramUpdate(context, message(312, 123456789, "/managecustomer"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(313, 123456789, `mode:f:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(314, 123456789, "01712345678"));
    state = (await context.states.get("123456789")).state;
    expect(state).toMatchObject({ currentStep: "MANAGE_CUSTOMER", selectedCustomerId: created.customer.id });

    await processTelegramUpdate(
      context,
      callback(315, 123456789, `idedit:w:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(316, 123456789, "@Soul_User"));
    state = (await context.states.get("123456789")).state;
    expect(state?.currentStep).toBe("CONFIRM_IDENTITY_CHANGE");
    await processTelegramUpdate(
      context,
      callback(317, 123456789, `idconfirm:${state?.payload.token ?? ""}`)
    );

    let customer = await context.customers.findById(created.customer.id);
    expect(customer).toMatchObject({ whatsappUsername: "Soul_User", pointBalanceUnits: 45_000 });
    expect((await context.transactions.listForCustomer(created.customer.id, 0)).transactions)
      .toHaveLength(1);

    await processTelegramUpdate(context, message(318, 123456789, "/managecustomer"));
    state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(319, 123456789, `mode:w:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(320, 123456789, "soul_user"));
    state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(321, 123456789, `idedit:p:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(322, 123456789, "01898765432"));
    state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(323, 123456789, `idconfirm:${state?.payload.token ?? ""}`)
    );

    customer = await context.customers.findById(created.customer.id);
    expect(customer).toMatchObject({
      whatsappNumber: "+8801898765432",
      phoneLast4: "5432",
      phoneLast5: "65432",
      whatsappUsername: "Soul_User",
      pointBalanceUnits: 45_000
    });
    expect((await context.transactions.listForCustomer(created.customer.id, 0)).transactions)
      .toHaveLength(1);
  });

  it("rejects a duplicate alias and returns to a usable identity panel with a fresh token", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await context.customers.createZeroBalance(
      { type: "WHATSAPP_USERNAME", username: { display: "Owned_Name", lookup: "owned_name" } },
      330,
      "2026-08-14T06:20:00.000Z"
    );
    const target = await context.customers.createZeroBalance(
      normalizePhone("01712345678"),
      331,
      "2026-08-14T06:21:00.000Z"
    );

    await processTelegramUpdate(context, message(332, 123456789, "/managecustomer"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(333, 123456789, `mode:f:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(334, 123456789, "01712345678"));
    state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(335, 123456789, `idedit:w:${state?.payload.token ?? ""}`)
    );
    const input = (await context.states.get("123456789")).state;
    await processTelegramUpdate(context, message(336, 123456789, "@OWNED_NAME"));
    const returned = (await context.states.get("123456789")).state;

    expect(returned).toMatchObject({
      currentStep: "MANAGE_CUSTOMER",
      selectedCustomerId: target.customer.id
    });
    expect(returned?.payload.token).not.toBe(input?.payload.token);
    expect((await context.customers.findById(target.customer.id))?.whatsappUsername).toBeNull();
    expect(calls.some((call) => String(call.payload?.text).includes("already belongs"))).toBe(true);
  });

  it("blocks removal of the final alias before confirmation", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      { type: "TELEGRAM_USERNAME", username: { display: "Only_User", lookup: "only_user" } },
      340,
      "2026-08-14T06:30:00.000Z"
    );
    await processTelegramUpdate(context, message(341, 123456789, "/managecustomer"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(342, 123456789, `mode:t:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(343, 123456789, "only_user"));
    state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(344, 123456789, `idremove:t:${state?.payload.token ?? ""}`)
    );

    expect((await context.states.get("123456789")).state).toMatchObject({
      currentStep: "MANAGE_CUSTOMER",
      selectedCustomerId: created.customer.id
    });
    expect((await context.customers.findById(created.customer.id))?.telegramUsername)
      .toBe("Only_User");
    expect(calls.some((call) => String(call.payload?.text).includes("final identifier cannot be removed")))
      .toBe(true);
  });

  it("does not overwrite an identifier changed after confirmation was prepared", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      { type: "WHATSAPP_USERNAME", username: { display: "Original_Name", lookup: "original_name" } },
      350,
      "2026-08-14T06:40:00.000Z"
    );
    await context.customers.changeIdentifier(
      created.customer.id,
      "WHATSAPP_PHONE",
      null,
      { type: "WHATSAPP_PHONE", phone: normalizePhone("01712345678") },
      "2026-08-14T06:41:00.000Z"
    );

    await processTelegramUpdate(context, message(351, 123456789, "/managecustomer"));
    let state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(352, 123456789, `mode:w:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(353, 123456789, "original_name"));
    state = (await context.states.get("123456789")).state;
    await processTelegramUpdate(
      context,
      callback(354, 123456789, `idedit:w:${state?.payload.token ?? ""}`)
    );
    await processTelegramUpdate(context, message(355, 123456789, "Requested_Name"));
    const confirmation = (await context.states.get("123456789")).state;
    expect(confirmation?.currentStep).toBe("CONFIRM_IDENTITY_CHANGE");

    await context.customers.changeIdentifier(
      created.customer.id,
      "WHATSAPP_USERNAME",
      "Original_Name",
      { type: "WHATSAPP_USERNAME", username: { display: "Concurrent_Name", lookup: "concurrent_name" } },
      "2026-08-14T06:42:00.000Z"
    );
    await processTelegramUpdate(
      context,
      callback(356, 123456789, `idconfirm:${confirmation?.payload.token ?? ""}`)
    );

    expect((await context.customers.findById(created.customer.id))?.whatsappUsername)
      .toBe("Concurrent_Name");
    const returned = (await context.states.get("123456789")).state;
    expect(returned).toMatchObject({
      currentStep: "MANAGE_CUSTOMER",
      selectedCustomerId: created.customer.id
    });
    expect(returned?.payload.token).not.toBe(confirmation?.payload.token);
    expect(calls.some((call) => String(call.payload?.text).includes("changed after this confirmation")))
      .toBe(true);
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
    await processTelegramUpdate(context, message(24_103, 123456789, "50"));
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
