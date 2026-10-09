import type { Customer } from "../types/models";
import { DomainError } from "./errors";

export const customerSplitAccountCount = (customer: Customer): number => {
  const count = [customer.whatsappNumber, customer.whatsappUsername, customer.telegramUsername]
    .filter((value) => value !== null).length;
  if (count < 2) {
    throw new DomainError("IDENTIFIER_CONFLICT", "At least two identifiers are required to split a customer.");
  }
  return count;
};
