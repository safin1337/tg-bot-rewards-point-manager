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

export interface TelegramNonTextMessage {
  message_id: number;
  from: TelegramUser;
  chat: TelegramChat;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data: string;
  message: {
    message_id: number;
    chat: TelegramChat;
  } | null;
}

export type TelegramUpdate =
  | { updateId: number; kind: "message"; message: TelegramMessage }
  | { updateId: number; kind: "non_text_message"; message: TelegramNonTextMessage }
  | { updateId: number; kind: "callback"; callbackQuery: TelegramCallbackQuery };

export type TelegramUpdateParseResult =
  | { disposition: "process"; update: TelegramUpdate }
  | { disposition: "ignore"; updateId: number }
  | { disposition: "malformed" };

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

const parseMessageEnvelope = (value: unknown): TelegramNonTextMessage | null => {
  const row = record(value);
  if (row === null || !safeInteger(row.message_id)) return null;
  const from = parseUser(row.from);
  const chat = parseChat(row.chat);
  return from === null || chat === null
    ? null
    : { message_id: row.message_id, from, chat };
};

const parseCallback = (value: unknown): TelegramCallbackQuery | null => {
  const row = record(value);
  if (row === null || typeof row.id !== "string" || typeof row.data !== "string") return null;
  const from = parseUser(row.from);
  if (from === null) return null;
  let message: TelegramCallbackQuery["message"] = null;
  if ("message" in row) {
    const messageRow = record(row.message);
    const chat = messageRow === null ? null : parseChat(messageRow.chat);
    if (messageRow === null || chat === null || !safeInteger(messageRow.message_id)) return null;
    message = { message_id: messageRow.message_id, chat };
  }
  return {
    id: row.id,
    from,
    data: row.data,
    message
  };
};

export const parseTelegramUpdate = (value: unknown): TelegramUpdateParseResult => {
  const row = record(value);
  if (row === null || !safeInteger(row.update_id)) return { disposition: "malformed" };
  const hasMessage = "message" in row;
  const hasCallback = "callback_query" in row;
  if (hasMessage && hasCallback) return { disposition: "malformed" };
  if (hasMessage) {
    const message = parseMessageEnvelope(row.message);
    if (message === null) return { disposition: "malformed" };
    const messageRow = record(row.message);
    if (messageRow === null) return { disposition: "malformed" };
    if ("text" in messageRow) {
      if (typeof messageRow.text !== "string") return { disposition: "malformed" };
      return {
        disposition: "process",
        update: {
          updateId: row.update_id,
          kind: "message",
          message: { ...message, text: messageRow.text }
        }
      };
    }
    return {
      disposition: "process",
      update: { updateId: row.update_id, kind: "non_text_message", message }
    };
  }
  if (hasCallback) {
    const callbackQuery = parseCallback(row.callback_query);
    return callbackQuery === null
      ? { disposition: "malformed" }
      : {
        disposition: "process",
        update: { updateId: row.update_id, kind: "callback", callbackQuery }
      };
  }
  if (Object.keys(row).length === 1) return { disposition: "malformed" };
  return { disposition: "ignore", updateId: row.update_id };
};
