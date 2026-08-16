import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../src/env";
import { handleWebhook } from "../src/index";
import { parseTelegramUpdate } from "../src/telegram/types";

const secretHeaders = { "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret" };

const webhookRequest = (body: string, headers: HeadersInit = secretHeaders): Request =>
  new Request("https://example.com/webhook", { method: "POST", headers, body });

const telegramFetch = (calls: string[], fail = false): typeof fetch =>
  (input: RequestInfo | URL): Promise<Response> => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (fail) return Promise.reject(new TypeError("fixture transport failure"));
    return Promise.resolve(Response.json({
      ok: true,
      result: { message_id: calls.length, chat: { id: 123456789 } }
    }));
  };

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM processed_updates"),
    env.DB.prepare("DELETE FROM conversation_states")
  ]);
});

describe("environment and update validation", () => {
  it("treats the administrator ID as a string and validates required bindings", () => {
    expect(readConfig(env).adminTelegramId).toBe("123456789");
    expect(() => readConfig({ ...env, BOT_TOKEN: "" })).toThrow(/configuration/i);
  });

  it("parses supported text messages and callbacks without accepting arbitrary JSON", () => {
    expect(parseTelegramUpdate({
      update_id: 1,
      message: { message_id: 2, from: { id: 3 }, chat: { id: 3 }, text: "/start" }
    })).toMatchObject({
      disposition: "process",
      update: { kind: "message", message: { text: "/start" } }
    });
    expect(parseTelegramUpdate({
      update_id: 2,
      callback_query: {
        id: "abc",
        from: { id: 3 },
        data: "cancel",
        message: { message_id: 4, chat: { id: 3 } }
      }
    })).toMatchObject({ disposition: "process", update: { kind: "callback" } });
    expect(parseTelegramUpdate({
      update_id: 5,
      callback_query: { id: "missing-message", from: { id: 3 }, data: "cancel" }
    })).toMatchObject({
      disposition: "process",
      update: { kind: "callback", callbackQuery: { message: null } }
    });
  });

  it("normalizes media messages to a minimal non-text envelope and drops captions and metadata", () => {
    const parsed = parseTelegramUpdate({
      update_id: 10,
      message: {
        message_id: 11,
        from: { id: 12, username: "FixtureSender" },
        chat: { id: 12, type: "private", title: "Fixture Chat" },
        caption: "/cancel",
        photo: [{ file_id: "fixture-media-id", width: 100, height: 100 }]
      }
    });

    expect(parsed).toEqual({
      disposition: "process",
      update: {
        updateId: 10,
        kind: "non_text_message",
        message: { message_id: 11, from: { id: 12 }, chat: { id: 12 } }
      }
    });
    expect(JSON.stringify(parsed)).not.toContain("/cancel");
    expect(JSON.stringify(parsed)).not.toContain("fixture-media-id");
    expect(JSON.stringify(parsed)).not.toContain("FixtureSender");
  });

  it.each([
    ["photo", { photo: [{ fixture: true }] }],
    ["document", { document: { fixture: true } }],
    ["sticker", { sticker: { fixture: true } }],
    ["voice", { voice: { fixture: true } }],
    ["location", { location: { latitude: 0, longitude: 0 } }]
  ])("classifies %s messages as non-text", (_label, content) => {
    expect(parseTelegramUpdate({
      update_id: 20,
      message: {
        message_id: 21,
        from: { id: 22 },
        chat: { id: 22 },
        ...content
      }
    })).toMatchObject({
      disposition: "process",
      update: { kind: "non_text_message" }
    });
  });

  it("rejects invalid supported envelopes and accepts valid irrelevant updates for ignoring", () => {
    expect(parseTelegramUpdate({ update_id: 30, message: { message_id: 1 } }))
      .toEqual({ disposition: "malformed" });
    expect(parseTelegramUpdate({
      update_id: 31,
      message: { message_id: 1, from: { id: 2 }, chat: { id: 2 }, text: 42 }
    })).toEqual({ disposition: "malformed" });
    expect(parseTelegramUpdate({
      update_id: 32,
      callback_query: { id: "x", from: { id: 2 }, data: "cancel", message: {} }
    })).toEqual({ disposition: "malformed" });
    expect(parseTelegramUpdate({ update_id: 33, callback_query: { id: "x" } }))
      .toEqual({ disposition: "malformed" });
    expect(parseTelegramUpdate({ update_id: 34, edited_message: {} }))
      .toEqual({ disposition: "ignore", updateId: 34 });
    expect(parseTelegramUpdate({ update_id: 35, channel_post: {} }))
      .toEqual({ disposition: "ignore", updateId: 35 });
    expect(parseTelegramUpdate({ update_id: 36 })).toEqual({ disposition: "malformed" });
    expect(parseTelegramUpdate({ message: {} })).toEqual({ disposition: "malformed" });
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
    const missing = await exports.default.fetch(webhookRequest(body, {}));
    const incorrect = await exports.default.fetch(webhookRequest(body, {
      "X-Telegram-Bot-Api-Secret-Token": "wrong"
    }));
    expect(missing.status).toBe(403);
    expect(incorrect.status).toBe(403);
  });

  it("returns HTTP 200 for valid photo and document updates", async () => {
    let updateId = 100;
    for (const content of [{ photo: [{ fixture: true }] }, { document: { fixture: true } }]) {
      const calls: string[] = [];
      const response = await handleWebhook(webhookRequest(JSON.stringify({
        update_id: updateId,
        message: {
          message_id: updateId + 1,
          from: { id: 123456789 },
          chat: { id: 123456789 },
          ...content
        }
      })), env, telegramFetch(calls));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(calls).toHaveLength(1);
      updateId += 2;
    }
  });

  it("acknowledges valid irrelevant updates without Telegram or D1 processing", async () => {
    const calls: string[] = [];
    const response = await handleWebhook(webhookRequest(JSON.stringify({
      update_id: 200,
      edited_message: { fixture: true }
    })), env, telegramFetch(calls, true));
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM processed_updates")
      .first<{ count: number }>())?.count).toBe(0);
  });

  it("returns HTTP 200 and makes no secondary send when the non-text notice fails", async () => {
    const calls: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await handleWebhook(webhookRequest(JSON.stringify({
        update_id: 210,
        message: {
          message_id: 211,
          from: { id: 123456789 },
          chat: { id: 123456789 },
          caption: "fixture caption that must not be logged",
          photo: [{ file_id: "fixture-file-id" }]
        }
      })), env, telegramFetch(calls, true));
      expect(response.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const log = String(errorSpy.mock.calls[0]?.[0]);
      expect(JSON.parse(log)).toEqual({
        message: "Unable to send the non-text Telegram update notice.",
        updateId: 210,
        updateType: "non_text_message",
        category: "telegram_api",
        telegramMethod: "sendMessage",
        telegramStatus: null
      });
      expect(log).not.toContain("fixture caption");
      expect(log).not.toContain("fixture-file-id");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("rejects malformed JSON and malformed supported updates safely", async () => {
    const malformedJson = await exports.default.fetch(webhookRequest("{"));
    const malformedUpdate = await exports.default.fetch(webhookRequest(JSON.stringify({
      update_id: 220,
      message: { message_id: 221, from: {}, chat: { id: 1 } }
    })));
    expect(malformedJson.status).toBe(400);
    expect(malformedUpdate.status).toBe(400);
  });

  it("preserves oversized payload rejection", async () => {
    const response = await exports.default.fetch(webhookRequest("{}", {
      ...secretHeaders,
      "content-length": "1000001"
    }));
    expect(response.status).toBe(413);
  });
});
