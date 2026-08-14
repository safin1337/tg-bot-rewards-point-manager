import { DomainError } from "./errors";
import type { NormalizedPhone } from "./phone";
import type { Customer } from "../types/models";

export const USERNAME_MAX_LENGTH = 64;

export type CustomerIdentifierType =
  | "WHATSAPP_PHONE"
  | "WHATSAPP_USERNAME"
  | "TELEGRAM_USERNAME";

export interface NormalizedUsername {
  display: string;
  lookup: string;
}

export type CustomerIdentifierInput =
  | { type: "WHATSAPP_PHONE"; phone: NormalizedPhone }
  | { type: "WHATSAPP_USERNAME" | "TELEGRAM_USERNAME"; username: NormalizedUsername };

export const normalizeUsername = (input: string): NormalizedUsername => {
  const trimmed = input.trim();
  const display = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (
    display.length === 0
    || display.length > USERNAME_MAX_LENGTH
    || !/^[A-Za-z0-9_]+$/.test(display)
  ) {
    throw new DomainError(
      "INVALID_USERNAME",
      `Enter a username using only A-Z, a-z, 0-9, and underscore, up to ${USERNAME_MAX_LENGTH} characters. A single leading @ is optional.`
    );
  }
  return { display, lookup: display.toLowerCase() };
};

export const identifierTypeLabel = (type: CustomerIdentifierType): string => {
  switch (type) {
    case "WHATSAPP_PHONE": return "WhatsApp Phone";
    case "WHATSAPP_USERNAME": return "WhatsApp Username";
    case "TELEGRAM_USERNAME": return "Telegram Username";
  }
};

export const usernameWithAt = (username: string): string => `@${username}`;

export const customerIdentifierValue = (
  customer: Customer,
  type: CustomerIdentifierType
): string | null => {
  switch (type) {
    case "WHATSAPP_PHONE": return customer.whatsappNumber;
    case "WHATSAPP_USERNAME": return customer.whatsappUsername;
    case "TELEGRAM_USERNAME": return customer.telegramUsername;
  }
};

export const customerPrimaryLabel = (customer: Pick<
  Customer,
  "whatsappNumber" | "whatsappUsername" | "telegramUsername"
>): string => {
  if (customer.whatsappNumber !== null) return customer.whatsappNumber;
  if (customer.whatsappUsername !== null) return `WhatsApp @${customer.whatsappUsername}`;
  if (customer.telegramUsername !== null) return `Telegram @${customer.telegramUsername}`;
  throw new Error("Customer has no identifier.");
};

export const identifierInputValue = (identifier: CustomerIdentifierInput): string =>
  identifier.type === "WHATSAPP_PHONE"
    ? identifier.phone.normalized
    : identifier.username.display;

export const identifierDisplayValue = (
  type: CustomerIdentifierType,
  value: string
): string => type === "WHATSAPP_PHONE" ? value : `@${value}`;
