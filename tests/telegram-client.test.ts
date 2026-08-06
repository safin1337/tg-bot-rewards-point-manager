import { describe, expect, it } from "vitest";
import { TelegramApiError, TelegramClient } from "../src/telegram/client";

const fetchReturning = (body: string, status = 200): typeof fetch =>
  ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    void input;
    void init;
    return Promise.resolve(new Response(body, {
      status,
      headers: { "content-type": "application/json" }
    }));
  });

describe("Telegram API envelope validation", () => {
  it.each([
    "null",
    "[]",
    "{}",
    '{"ok":"true","result":true}',
    '{"ok":true}',
    '{"ok":true,"result":null'
  ])("rejects malformed or invalid response %s", async (body) => {
    const client = new TelegramClient("test-token", fetchReturning(body));
    await expect(client.sendMessage(1, "test")).rejects.toBeInstanceOf(TelegramApiError);
  });

  it("rejects non-2xx Telegram failures without exposing the bot token", async () => {
    const token = "sensitive-test-token";
    const client = new TelegramClient(
      token,
      fetchReturning('{"ok":false,"description":"Bad Request"}', 400)
    );
    const error = await client.sendMessage(1, "test").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(TelegramApiError);
    expect(String(error)).toContain("Bad Request");
    expect(String(error)).not.toContain(token);
    expect(error).toMatchObject({
      method: "sendMessage",
      status: 400,
      message: "Bad Request"
    });
  });

  it("normalizes Telegram rejection descriptions for safe structured logs", async () => {
    const client = new TelegramClient(
      "sensitive-test-token",
      fetchReturning('{"ok":false,"description":"Bad Request:\\ninvalid reply markup"}', 400)
    );

    const error = await client.sendMessage(1, "test").catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      method: "sendMessage",
      status: 400,
      message: "Bad Request: invalid reply markup"
    });
  });

  it("classifies transport failures without exposing their original message", async () => {
    const fetcher: typeof fetch = () => Promise.reject(
      new TypeError("network failure containing sensitive request details")
    );
    const client = new TelegramClient("sensitive-test-token", fetcher);

    const error = await client.sendMessage(1, "test").catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      method: "sendMessage",
      status: null,
      message: "Telegram network request failed (TypeError)."
    });
    expect(String(error)).not.toContain("sensitive request details");
  });

  it("classifies aborted transport requests as timeouts", async () => {
    const fetcher: typeof fetch = () => Promise.reject(new DOMException("aborted", "AbortError"));
    const client = new TelegramClient("sensitive-test-token", fetcher);

    await expect(client.sendMessage(1, "test")).rejects.toMatchObject({
      method: "sendMessage",
      status: null,
      message: "Telegram request timed out."
    });
  });

  it("does not call an injected native-style fetcher with TelegramClient as its receiver", async () => {
    const fetcher = function (this: unknown): Promise<Response> {
      if (this instanceof TelegramClient) {
        return Promise.reject(new TypeError("Illegal invocation"));
      }
      return Promise.resolve(new Response(
        '{"ok":true,"result":{"message_id":1,"chat":{"id":1}}}',
        {
        status: 200,
        headers: { "content-type": "application/json" }
        }
      ));
    } as typeof fetch;
    const client = new TelegramClient("test-token", fetcher);

    await expect(client.sendMessage(1, "test")).resolves.toEqual({ messageId: 1, chatId: 1 });
  });

  it("accepts a valid Telegram envelope", async () => {
    const client = new TelegramClient("test-token", fetchReturning('{"ok":true,"result":true}'));
    await expect(client.answerCallbackQuery("callback-id")).resolves.toBeUndefined();
  });
});
