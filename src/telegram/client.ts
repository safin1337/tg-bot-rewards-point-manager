import type { InlineKeyboardMarkup } from "./types";

export class TelegramApiError extends Error {
  constructor(
    message = "Telegram did not accept the request.",
    readonly method = "unknown",
    readonly status: number | null = null
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

export interface SendMessageOptions {
  replyMarkup?: InlineKeyboardMarkup;
  parseMode?: "HTML";
}

export class TelegramClient {
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly token: string,
    fetcher: typeof fetch = fetch
  ) {
    // Native Workers APIs can reject calls made with a class instance as their
    // receiver. Keep the injected function in a closure so `this.fetcher()`
    // never forwards the TelegramClient instance to the native fetch function.
    this.fetcher = (input, init) => fetcher(input, init);
  }

  private async call(method: string, body: BodyInit, headers?: HeadersInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const requestInit: RequestInit = {
        method: "POST",
        body,
        signal: controller.signal
      };
      if (headers !== undefined) requestInit.headers = headers;
      const response = await this.fetcher(`https://api.telegram.org/bot${this.token}/${method}`, requestInit);
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new TelegramApiError("Telegram returned an invalid response.", method, response.status);
      }
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new TelegramApiError("Telegram returned an invalid response.", method, response.status);
      }
      const envelope = payload as Record<string, unknown>;
      if (!response.ok || envelope.ok !== true || !("result" in envelope) || envelope.result === undefined) {
        const safeDescription = typeof envelope.description === "string"
          ? envelope.description.replace(/[\r\n\t]/g, " ").slice(0, 200)
          : "Telegram rejected the request.";
        throw new TelegramApiError(safeDescription, method, response.status);
      }
      return envelope.result;
    } catch (error: unknown) {
      if (error instanceof TelegramApiError) throw error;
      const timedOut = controller.signal.aborted
        || (error instanceof DOMException && error.name === "AbortError");
      if (timedOut) {
        throw new TelegramApiError("Telegram request timed out.", method);
      }
      const errorType = error instanceof Error ? error.name : "UnknownError";
      throw new TelegramApiError(`Telegram network request failed (${errorType}).`, method);
    } finally {
      clearTimeout(timeout);
    }
  }

  private callJson(method: string, value: unknown): Promise<unknown> {
    return this.call(method, JSON.stringify(value), { "content-type": "application/json" });
  }

  sendMessage(chatId: number, text: string, options: SendMessageOptions = {}): Promise<unknown> {
    return this.callJson("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode ?? "HTML",
      ...(options.replyMarkup === undefined ? {} : { reply_markup: options.replyMarkup })
    });
  }

  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup
  ): Promise<unknown> {
    return this.callJson("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup })
    });
  }

  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<unknown> {
    return this.callJson("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text === undefined ? {} : { text: text.slice(0, 200) })
    });
  }

  sendDocument(chatId: number, filename: string, contents: string, caption: string): Promise<unknown> {
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set("caption", caption);
    form.set("document", new Blob([contents], { type: "text/csv;charset=utf-8" }), filename);
    return this.call("sendDocument", form);
  }
}
