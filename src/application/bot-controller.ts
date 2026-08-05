import type { TelegramUpdate } from "../telegram/types";
import { BRAND, dashboardMessage } from "../telegram/messages";
import { dashboardKeyboard } from "../telegram/keyboards";
import { handleCallback } from "../workflows/callback-handler";
import { extractCommand, handleCommand } from "../workflows/command-handler";
import type { WorkflowContext } from "../workflows/context";
import { handleStateMessage } from "../workflows/message-handler";

const unauthorizedMessage = `${BRAND}\n\n⛔ This private bot is restricted to the authorized SoulShop administrator.`;
const oldUpdateMessage = `${BRAND}\n\n⚠️ An older Telegram update was ignored so it cannot continue or replace the current operation.`;

export const processTelegramUpdate = async (
  context: WorkflowContext,
  update: TelegramUpdate
): Promise<void> => {
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
      await context.telegram.sendMessage(update.callbackQuery.message.chat.id, oldUpdateMessage);
      return;
    }
    await handleCallback(
      context,
      userId,
      update.callbackQuery.message.chat.id,
      update.updateId,
      update.callbackQuery.data
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
