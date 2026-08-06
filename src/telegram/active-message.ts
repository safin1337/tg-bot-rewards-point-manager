import { TelegramApiError, type TelegramBotMessage, type TelegramClient } from "./client";
import type { InlineKeyboardMarkup } from "./types";

export interface ActiveMessageTarget {
  chatId: number;
  messageId: number | null;
}

export interface ActiveMessageResult extends TelegramBotMessage {
  delivery: "EDITED" | "UNCHANGED" | "SENT";
}

const EMPTY_KEYBOARD: InlineKeyboardMarkup = { inline_keyboard: [] };

const messageNotModified = (error: TelegramApiError): boolean =>
  error.method === "editMessageText"
  && error.message.toLowerCase().includes("message is not modified");

export const editOrSendFallback = async (
  telegram: TelegramClient,
  target: ActiveMessageTarget,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<ActiveMessageResult> => {
  if (target.messageId !== null) {
    try {
      const edited = await telegram.editMessageText(
        target.chatId,
        target.messageId,
        text,
        replyMarkup ?? EMPTY_KEYBOARD
      );
      return { ...edited, delivery: "EDITED" };
    } catch (error: unknown) {
      if (error instanceof TelegramApiError && messageNotModified(error)) {
        return { chatId: target.chatId, messageId: target.messageId, delivery: "UNCHANGED" };
      }
      if (!(error instanceof TelegramApiError)) throw error;
    }
  }
  const sent = await telegram.sendMessage(target.chatId, text, {
    ...(replyMarkup === undefined ? {} : { replyMarkup })
  });
  return { ...sent, delivery: "SENT" };
};
