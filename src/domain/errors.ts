export class DomainError extends Error {
  constructor(
    readonly code:
      | "INVALID_POINTS"
      | "POINT_PRECISION"
      | "INVALID_PURCHASE"
      | "UNSAFE_INTEGER"
      | "INVALID_PHONE"
      | "INVALID_USERNAME"
      | "INVALID_SEARCH"
      | "IDENTIFIER_CONFLICT"
      | "IDENTIFIER_STALE"
      | "LAST_IDENTIFIER"
      | "INSUFFICIENT_BALANCE"
      | "BALANCE_CONFLICT"
      | "DUPLICATE_UPDATE"
      | "EXPORT_TOO_LARGE",
    message: string
  ) {
    super(message);
    this.name = "DomainError";
  }
}
