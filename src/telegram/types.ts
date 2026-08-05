export interface TelegramUser {
  id: number;
}

export interface TelegramChat {
  id: number;
}

export interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: TelegramChat;
  text: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data: string;
  message: {
    message_id: number;
    chat: TelegramChat;
  };
}

export type TelegramUpdate =
  | { updateId: number; kind: "message"; message: TelegramMessage }
  | { updateId: number; kind: "callback"; callbackQuery: TelegramCallbackQuery };

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineButton[][];
}

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;

const safeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

const parseUser = (value: unknown): TelegramUser | null => {
  const row = record(value);
  return row !== null && safeInteger(row.id) ? { id: row.id } : null;
};

const parseChat = (value: unknown): TelegramChat | null => {
  const row = record(value);
  return row !== null && safeInteger(row.id) ? { id: row.id } : null;
};

const parseMessage = (value: unknown): TelegramMessage | null => {
  const row = record(value);
  if (row === null || !safeInteger(row.message_id) || typeof row.text !== "string") return null;
  const from = parseUser(row.from);
  const chat = parseChat(row.chat);
  return from === null || chat === null
    ? null
    : { message_id: row.message_id, from, chat, text: row.text };
};

const parseCallback = (value: unknown): TelegramCallbackQuery | null => {
  const row = record(value);
  if (row === null || typeof row.id !== "string" || typeof row.data !== "string") return null;
  const from = parseUser(row.from);
  const messageRow = record(row.message);
  const chat = messageRow === null ? null : parseChat(messageRow.chat);
  if (from === null || messageRow === null || chat === null || !safeInteger(messageRow.message_id)) return null;
  return {
    id: row.id,
    from,
    data: row.data,
    message: { message_id: messageRow.message_id, chat }
  };
};

export const parseTelegramUpdate = (value: unknown): TelegramUpdate | null => {
  const row = record(value);
  if (row === null || !safeInteger(row.update_id)) return null;
  const message = parseMessage(row.message);
  if (message !== null) return { updateId: row.update_id, kind: "message", message };
  const callbackQuery = parseCallback(row.callback_query);
  if (callbackQuery !== null) return { updateId: row.update_id, kind: "callback", callbackQuery };
  return null;
};
