import type { Customer } from "../types/models";
import { DomainError } from "./errors";
import { safeBalanceAfter } from "./rewards";

export const mergedCustomerBalance = (target: Customer, source: Customer): number => {
  if (target.id === source.id) {
    throw new DomainError("IDENTIFIER_CONFLICT", "Choose two different customers to merge.");
  }
  if (target.isTest !== source.isTest) {
    throw new DomainError("IDENTIFIER_CONFLICT", "Test accounts and customer accounts cannot be merged.");
  }
  for (const key of ["whatsappNumber", "whatsappUsername", "telegramUsername"] as const) {
    if (target[key] !== null && source[key] !== null) {
      throw new DomainError(
        "IDENTIFIER_CONFLICT",
        "These customers have conflicting identifiers. Review their identities before merging."
      );
    }
  }
  return safeBalanceAfter(target.pointBalanceUnits, source.pointBalanceUnits);
};

export const customerMergeFingerprint = async (customer: Customer): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(customer))
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
