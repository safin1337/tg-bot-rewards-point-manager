import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processTelegramUpdate } from "../src/application/bot-controller";
import { normalizePhone } from "../src/domain/phone";
import { purchaseToPointUnits } from "../src/domain/rewards";
import { readConfig } from "../src/env";
import { TelegramApiError } from "../src/telegram/client";
import { quickBuyInvalidInputMessage } from "../src/telegram/messages";
import type { TelegramUpdate } from "../src/telegram/types";
import { makeWorkflowContext } from "../src/workflows/context";

interface ApiCall {
  method: string;
  payload: Record<string, unknown> | null;
}

const calls: ApiCall[] = [];
let failNextPurchaseReceipt = false;

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
  if (
    failNextPurchaseReceipt
    && method === "sendMessage"
    && String(payload?.text).includes("Purchase Successfully Recorded")
  ) {
    failNextPurchaseReceipt = false;
    return Promise.resolve(new Response(JSON.stringify({
      ok: false,
      description: "Bad Request: simulated receipt delivery failure"
    }), {
      status: 400,
      headers: { "content-type": "application/json" }
    }));
  }
  const result: unknown = method === "answerCallbackQuery"
    ? true
    : {
      message_id: calls.length,
      chat: { id: typeof payload?.chat_id === "number" ? payload.chat_id : 123456789 }
    };
  return Promise.resolve(new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" }
  }));
}) as typeof fetch;

const message = (updateId: number, text: string): TelegramUpdate => ({
  updateId,
  kind: "message",
  message: {
    message_id: updateId,
    from: { id: 123456789 },
    chat: { id: 123456789 },
    text
  }
});

const count = async (table: string): Promise<number> => {
  const allowed = ["customers", "transactions", "mutation_receipts", "leaderboard_aggregates"];
  if (!allowed.includes(table)) throw new Error("Unexpected table name.");
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
  if (row === null || !Number.isSafeInteger(row.count)) throw new Error("Invalid count.");
  return row.count;
};

beforeEach(async () => {
  calls.length = 0;
  failNextPurchaseReceipt = false;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM processed_updates"),
    env.DB.prepare("DELETE FROM conversation_states"),
    env.DB.prepare("DELETE FROM leaderboard_reset_receipts"),
    env.DB.prepare("DELETE FROM leaderboard_aggregates"),
    env.DB.prepare("DELETE FROM leaderboard_periods"),
    env.DB.prepare("DELETE FROM transactions"),
    env.DB.prepare("DELETE FROM mutation_receipts"),
    env.DB.prepare("DELETE FROM lifetime_redemption_snapshots"),
    env.DB.prepare("DELETE FROM customers")
  ]);
});

describe("Quick Buy", () => {
  it("preserves the approved concise invalid-input response exactly", () => {
    expect(quickBuyInvalidInputMessage()).toBe(
      "⚠️ Invalid input.\n"
      + "Send the WhatsApp number on first line and\n"
      + "purchase amount on the next line.\n\n"
      + "No customer was created and no points were assigned."
    );
  });

  it("creates a normal phone customer and records a two-line purchase immediately", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);

    await processTelegramUpdate(context, message(100, "/quickbuy"));
    expect((await context.states.get("123456789")).state).toMatchObject({
      activeOperation: "PURCHASE",
      currentStep: "AWAIT_QUICK_PURCHASE",
      operationStartedUpdateId: 100
    });
    expect(String(calls.at(-1)?.payload?.text)).toContain("without a confirmation screen");

    await processTelegramUpdate(context, message(101, "017776-22294\n2950"));

    const customer = await context.customers.findByPhone("+8801777622294");
    expect(customer).toMatchObject({
      whatsappNumber: "+8801777622294",
      pointBalanceUnits: purchaseToPointUnits(2_950),
      isTest: false,
      creationTelegramUpdateId: 101,
      latestMutationTelegramUpdateId: 101
    });
    expect((await context.states.get("123456789")).state).toBeNull();
    expect(await count("customers")).toBe(1);
    expect(await count("transactions")).toBe(1);
    expect(await count("mutation_receipts")).toBe(1);
    const receipt = calls.find((call) =>
      String(call.payload?.text).includes("Purchase Successfully Recorded")
    );
    expect(receipt).toMatchObject({ method: "sendMessage" });
    expect(String(receipt?.payload?.text)).toContain("`Purchase Amount: BDT 2,950.00`");
  });

  it("uses an exact existing WhatsApp phone match without creating another customer", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const existing = await context.customers.createZeroBalance(
      normalizePhone("01712345678"),
      200,
      new Date().toISOString()
    );

    await processTelegramUpdate(context, message(201, "/quickbuy"));
    await processTelegramUpdate(context, message(202, " 01712-345 678 \r\n50"));

    expect(await count("customers")).toBe(1);
    expect((await context.customers.findById(existing.customer.id))?.pointBalanceUnits)
      .toBe(purchaseToPointUnits(50));
  });

  it("accepts a valid explicitly prefixed international WhatsApp number", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(210, "/quickbuy"));
    await processTelegramUpdate(context, message(211, "+34 672-573-733\n100"));

    expect(await context.customers.findByPhone("+34672573733")).toMatchObject({
      pointBalanceUnits: purchaseToPointUnits(100),
      isTest: false
    });
  });

  it.each([
    ["one line", "01777622294 2950"],
    ["extra line", "01777622294\n2950\nextra"],
    ["blank phone", "\n2950"],
    ["blank amount", "01777622294\n"],
    ["blank line between values", "01777622294\n\n2950"],
    ["phone suffix", "2294\n2950"],
    ["WhatsApp username", "@customer_name\n2950"],
    ["Telegram username", "customer_name\n2950"],
    ["decimal phone", "017776.22294\n2950"],
    ["decimal amount", "01777622294\n2950.00"],
    ["comma amount", "01777622294\n2,950"],
    ["letter in amount", "01777622294\n295O"],
    ["signed amount", "01777622294\n+2950"],
    ["zero amount", "01777622294\n0"],
    ["amount whitespace", "01777622294\n 2950"],
    ["trailing newline", "01777622294\n2950\n"]
  ])("rejects %s before any customer or reward write", async (_case, input) => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(300, "/quickbuy"));
    calls.length = 0;
    const phoneLookup = vi.spyOn(context.customers, "findByPhone");

    await processTelegramUpdate(context, message(301, input));

    expect(phoneLookup).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "sendMessage",
      payload: { text: quickBuyInvalidInputMessage() }
    });
    expect((await context.states.get("123456789")).state?.currentStep)
      .toBe("AWAIT_QUICK_PURCHASE");
    expect(await count("customers")).toBe(0);
    expect(await count("transactions")).toBe(0);
    expect(await count("mutation_receipts")).toBe(0);
    expect(await count("leaderboard_aggregates")).toBe(0);
  });

  it("preserves test-account classification and leaderboard exclusions", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    const created = await context.customers.createZeroBalance(
      normalizePhone("01700000009"),
      350,
      new Date().toISOString()
    );
    await context.customers.changeTestAccountStatus(
      created.customer.id,
      false,
      true,
      new Date().toISOString()
    );

    await processTelegramUpdate(context, message(351, "/quickbuy"));
    await processTelegramUpdate(context, message(352, "01700000009\n500"));

    expect(await context.customers.findById(created.customer.id)).toMatchObject({
      isTest: true,
      pointBalanceUnits: purchaseToPointUnits(500)
    });
    expect(await count("leaderboard_aggregates")).toBe(0);
  });

  it("restarts Quick Buy at its own input step and cancel exits it", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(400, "/quickbuy"));
    const first = (await context.states.get("123456789")).state;

    await processTelegramUpdate(context, message(401, "/restart"));
    const restarted = (await context.states.get("123456789")).state;
    expect(restarted).toMatchObject({
      activeOperation: "PURCHASE",
      currentStep: "AWAIT_QUICK_PURCHASE",
      operationStartedUpdateId: 401
    });
    expect(restarted?.payload.token).not.toBe(first?.payload.token);

    await processTelegramUpdate(context, message(402, "/cancel"));
    expect((await context.states.get("123456789")).state).toBeNull();
    expect(await count("customers")).toBe(0);
  });

  it("retries receipt delivery idempotently after the purchase has committed", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(500, "/quickbuy"));
    failNextPurchaseReceipt = true;

    await expect(processTelegramUpdate(
      context,
      message(501, "01700000001\n500")
    )).rejects.toBeInstanceOf(TelegramApiError);

    const committed = await context.customers.findByPhone("+8801700000001");
    expect(committed?.pointBalanceUnits).toBe(purchaseToPointUnits(500));
    expect((await context.states.get("123456789")).state?.currentStep)
      .toBe("AWAIT_QUICK_PURCHASE");
    expect(await count("transactions")).toBe(1);

    await processTelegramUpdate(context, message(501, "01700000001\n500"));

    expect((await context.states.get("123456789")).state).toBeNull();
    expect((await context.customers.findByPhone("+8801700000001"))?.pointBalanceUnits)
      .toBe(purchaseToPointUnits(500));
    expect(await count("transactions")).toBe(1);
    expect(await count("mutation_receipts")).toBe(1);
  });

  it("routes /testaccounts directly to the existing test-account workflow", async () => {
    const context = makeWorkflowContext(env.DB, readConfig(env), fakeFetch);
    await processTelegramUpdate(context, message(600, "/testaccounts"));

    expect((await context.states.get("123456789")).state).toMatchObject({
      activeOperation: "MANAGE_TEST_ACCOUNT",
      currentStep: "SELECT_MODE",
      operationStartedUpdateId: 600
    });
    expect(String(calls.at(-1)?.payload?.text)).toContain("Manage Test Accounts");
  });
});
