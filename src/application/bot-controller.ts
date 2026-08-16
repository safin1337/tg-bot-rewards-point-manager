import type { TelegramUpdate } from "../telegram/types";
import {
  BRAND,
  BRAND_NAME_HTML,
  dashboardMessage,
  unsupportedNonTextMessage
} from "../telegram/messages";
import { dashboardKeyboard } from "../telegram/keyboards";
import { handleCallback } from "../workflows/callback-handler";
import { extractCommand, handleCommand } from "../workflows/command-handler";
import type { WorkflowContext } from "../workflows/context";
import { handleStateMessage } from "../workflows/message-handler";
import { editOrSendFallback } from "../telegram/active-message";

const unauthorizedMessage = `${BRAND}\n\n⛔ This private bot is restricted to the authorized ${BRAND_NAME_HTML} administrator.`;
const oldUpdateMessage = `${BRAND}\n\n⚠️ An older Telegram update was ignored so it cannot continue or replace the current operation.`;

export const processTelegramUpdate = async (
  context: WorkflowContext,
  update: TelegramUpdate
): Promise<void> => {
  if (update.kind === "non_text_message") {
    const userId = String(update.message.from.id);
    const chatId = update.message.chat.id;
    if (userId !== context.config.adminTelegramId) {
      await context.telegram.sendMessage(chatId, unauthorizedMessage);
      return;
    }
    await context.telegram.sendMessage(chatId, unsupportedNonTextMessage());
    return;
  }

  if (update.kind === "callback") {
    const userId = String(update.callbackQuery.from.id);
    if (userId !== context.config.adminTelegramId) {
      await context.telegram.answerCallbackQuery(update.callbackQuery.id, "Unauthorized");
      return;
    }
    await context.telegram.answerCallbackQuery(update.callbackQuery.id);
    const current = await context.states.get(userId);
    if (
      current.state !== null
      && update.updateId <= current.state.operationStartedUpdateId
    ) {
      const chatId = update.callbackQuery.message?.chat.id ?? update.callbackQuery.from.id;
      await editOrSendFallback(context.telegram, {
        chatId,
        messageId: update.callbackQuery.message?.message_id ?? null
      }, oldUpdateMessage);
      return;
    }
    await handleCallback(
      context,
      userId,
      update.callbackQuery.message?.chat.id ?? update.callbackQuery.from.id,
      update.updateId,
      update.callbackQuery.data,
      update.callbackQuery.message?.message_id ?? null
    );
    return;
  }

  const userId = String(update.message.from.id);
  const chatId = update.message.chat.id;
  if (userId !== context.config.adminTelegramId) {
    await context.telegram.sendMessage(chatId, unauthorizedMessage);
    return;
  }

  const current = await context.states.get(userId);
  if (
    current.state !== null
    && update.updateId <= current.state.operationStartedUpdateId
  ) {
    await context.telegram.sendMessage(chatId, oldUpdateMessage);
    return;
  }

  const command = extractCommand(update.message.text);
  if (command !== null) {
    const handled = await handleCommand(context, userId, chatId, command, update.updateId);
    if (!handled) {
      await context.telegram.sendMessage(
        chatId,
        `${BRAND}\n\n⚠️ Unknown command. Use /help to see the available commands.`
      );
    }
    return;
  }

  if (current.state === null) {
    await context.telegram.sendMessage(
      chatId,
      current.expired
        ? `${BRAND}\n\n⏱️ The previous operation expired. Please start again.`
        : dashboardMessage(),
      { replyMarkup: dashboardKeyboard() }
    );
    return;
  }
  await handleStateMessage(context, current.state, chatId, update.message.text);
};
