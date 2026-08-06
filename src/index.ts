import { processTelegramUpdate } from "./application/bot-controller";
import { readConfig, type Env } from "./env";
import { TelegramApiError } from "./telegram/client";
import { parseTelegramUpdate, type TelegramUpdate } from "./telegram/types";
import { BRAND } from "./telegram/messages";
import { makeWorkflowContext, type WorkflowContext } from "./workflows/context";

const json = (body: unknown, status: number, headers: HeadersInit = {}): Response => {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
};

const methodNotAllowed = (allow: string): Response =>
  json({ error: "Method not allowed" }, 405, { allow });

const safeLogFailure = (update: TelegramUpdate, error: unknown): void => {
  const logEntry: Record<string, string | number | null> = {
    message: "Telegram update processing failed.",
    updateId: update.updateId,
    updateType: update.kind,
    category: error instanceof TelegramApiError
      ? "telegram_api"
      : error instanceof Error
        ? error.name
        : "unknown"
  };
  if (error instanceof TelegramApiError) {
    logEntry.telegramMethod = error.method;
    logEntry.telegramStatus = error.status;
  }
  console.error(JSON.stringify(logEntry));
};

const trySendFailure = async (
  context: WorkflowContext,
  update: TelegramUpdate,
  originalError: unknown
): Promise<void> => {
  if (originalError instanceof TelegramApiError) return;
  const userId = update.kind === "message" ? update.message.from.id : update.callbackQuery.from.id;
  if (String(userId) !== context.config.adminTelegramId) return;
  const chatId = update.kind === "message"
    ? update.message.chat.id
    : update.callbackQuery.message?.chat.id ?? update.callbackQuery.from.id;
  try {
    await context.telegram.sendMessage(
      chatId,
      `${BRAND}\n\n⚠️ The operation could not be completed. No success should be assumed. Please retry or use /restart.`
    );
  } catch {
    console.error(JSON.stringify({
      message: "Unable to send the sanitized failure message.",
      updateId: update.updateId,
      updateType: update.kind
    }));
  }
};

const handleWebhook = async (request: Request, env: Env): Promise<Response> => {
  let config;
  try {
    config = readConfig(env);
  } catch {
    return json({ error: "Service configuration is unavailable" }, 503);
  }

  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secret === null || secret !== config.webhookSecret) {
    return json({ error: "Forbidden" }, 403);
  }

  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > 1_000_000) {
    return json({ error: "Payload too large" }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Malformed JSON" }, 400);
  }
  const update = parseTelegramUpdate(body);
  if (update === null) {
    return json({ error: "Unsupported Telegram update" }, 400);
  }

  const context = makeWorkflowContext(env.DB, config);
  try {
    await processTelegramUpdate(context, update);
    return json({ ok: true }, 200);
  } catch (error: unknown) {
    safeLogFailure(update, error);
    await trySendFailure(context, update, error);
    return json({ error: "Update processing failed" }, 500);
  }
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return request.method === "GET"
        ? json({ status: "ok" }, 200)
        : methodNotAllowed("GET");
    }
    if (url.pathname === "/webhook") {
      return request.method === "POST"
        ? handleWebhook(request, env)
        : methodNotAllowed("POST");
    }
    return json({ error: "Not found" }, 404);
  }
};
