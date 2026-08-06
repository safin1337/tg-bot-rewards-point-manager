import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { parseTelegramUpdate } from "../src/telegram/types";
import { readConfig } from "../src/env";

describe("environment and update validation", () => {
  it("treats the administrator ID as a string and validates required bindings", () => {
    expect(readConfig(env).adminTelegramId).toBe("123456789");
    expect(() => readConfig({ ...env, BOT_TOKEN: "" })).toThrow(/configuration/i);
  });

  it("parses supported messages and callbacks without accepting arbitrary JSON", () => {
    expect(parseTelegramUpdate({
      update_id: 1,
      message: { message_id: 2, from: { id: 3 }, chat: { id: 3 }, text: "/start" }
    })?.kind).toBe("message");
    expect(parseTelegramUpdate({
      update_id: 2,
      callback_query: {
        id: "abc",
        from: { id: 3 },
        data: "cancel",
        message: { message_id: 4, chat: { id: 3 } }
      }
    })?.kind).toBe("callback");
    expect(parseTelegramUpdate({
      update_id: 5,
      callback_query: { id: "missing-message", from: { id: 3 }, data: "cancel" }
    })).toMatchObject({ kind: "callback", callbackQuery: { message: null } });
    expect(parseTelegramUpdate({ update_id: 3, edited_message: {} })).toBeNull();
    expect(parseTelegramUpdate({ update_id: 4, callback_query: { id: "x" } })).toBeNull();
  });
});

describe("Worker HTTP boundary", () => {
  it("returns only a safe health response", async () => {
    const response = await exports.default.fetch("https://example.com/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("uses method-aware routing", async () => {
    const healthPost = await exports.default.fetch(new Request("https://example.com/health", { method: "POST" }));
    const webhookGet = await exports.default.fetch("https://example.com/webhook");
    const missing = await exports.default.fetch("https://example.com/missing");
    expect(healthPost.status).toBe(405);
    expect(healthPost.headers.get("allow")).toBe("GET");
    expect(webhookGet.status).toBe(405);
    expect(webhookGet.headers.get("allow")).toBe("POST");
    expect(missing.status).toBe(404);
  });

  it("rejects missing and incorrect webhook secrets before processing", async () => {
    const body = JSON.stringify({
      update_id: 1,
      message: { message_id: 2, from: { id: 3 }, chat: { id: 3 }, text: "/start" }
    });
    const missing = await exports.default.fetch(new Request("https://example.com/webhook", {
      method: "POST",
      body
    }));
    const incorrect = await exports.default.fetch(new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "wrong" },
      body
    }));
    expect(missing.status).toBe(403);
    expect(incorrect.status).toBe(403);
  });

  it("rejects malformed JSON and unsupported updates safely", async () => {
    const headers = { "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret" };
    const malformed = await exports.default.fetch(new Request("https://example.com/webhook", {
      method: "POST",
      headers,
      body: "{"
    }));
    const unsupported = await exports.default.fetch(new Request("https://example.com/webhook", {
      method: "POST",
      headers,
      body: JSON.stringify({ update_id: 1, channel_post: {} })
    }));
    expect(malformed.status).toBe(400);
    expect(unsupported.status).toBe(400);
  });
});
