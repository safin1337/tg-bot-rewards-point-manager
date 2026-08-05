import { DomainError } from "./errors";

const REMOVABLE = /[\p{White_Space}\-\u2010\u2011\u2012\u2013\u2014\u2212]/gu;
const BANGLADESH_LOCAL = /^01[3-9]\d{8}$/;
const BANGLADESH_COUNTRY = /^8801[3-9]\d{8}$/;
const E164_DIGITS = /^[1-9]\d{6,14}$/;

export interface NormalizedPhone {
  normalized: string;
  last4: string;
  last5: string;
}

export const cleanPhoneInput = (input: string): string => input.replace(REMOVABLE, "");

export const normalizePhone = (input: string): NormalizedPhone => {
  const cleaned = cleanPhoneInput(input);
  if (cleaned.length === 0 || !/^\+?\d+$/.test(cleaned)) {
    throw new DomainError("INVALID_PHONE", "Enter a valid WhatsApp number using digits and an optional leading +.");
  }

  let normalized: string;
  if (BANGLADESH_LOCAL.test(cleaned)) {
    normalized = `+880${cleaned.slice(1)}`;
  } else if (BANGLADESH_COUNTRY.test(cleaned)) {
    normalized = `+${cleaned}`;
  } else if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1);
    if (digits.startsWith("880") && !BANGLADESH_COUNTRY.test(digits)) {
      throw new DomainError("INVALID_PHONE", "Enter a valid Bangladesh mobile number.");
    }
    if (!E164_DIGITS.test(digits)) {
      throw new DomainError("INVALID_PHONE", "Enter a practical international number in E.164 format.");
    }
    normalized = cleaned;
  } else {
    throw new DomainError("INVALID_PHONE", "Use a Bangladesh mobile number or an international number beginning with +.");
  }

  const digits = normalized.slice(1);
  return {
    normalized,
    last4: digits.slice(-4),
    last5: digits.slice(-5)
  };
};

export const validateSearchDigits = (input: string): string => {
  if (!/^\d{4,5}$/.test(input)) {
    throw new DomainError("INVALID_SEARCH", "Enter exactly the last 4 or 5 digits, with no spaces or symbols.");
  }
  return input;
};

export const maskPhone = (phone: string): string =>
  phone.length <= 6 ? "***" : `${phone.slice(0, 4)}***${phone.slice(-3)}`;
