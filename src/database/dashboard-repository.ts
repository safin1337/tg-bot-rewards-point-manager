import { APP_RUNTIME_CONFIG } from "../config/app-config";
import type { DashboardSummary } from "../types/models";

interface DashboardRow {
  customer_count: unknown;
  current_point_units: unknown;
}

interface RedemptionRow {
  redemption_count: unknown;
  cumulative_redeemed_point_units: unknown;
}

const safeNonnegative = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
};

export class DashboardRepository {
  constructor(private readonly db: D1Database) {}

  async summary(): Promise<DashboardSummary> {
    const customerFilter = APP_RUNTIME_CONFIG.analytics.testAccounts.excludeFromDashboard
      ? "WHERE is_test = 0"
      : "";
    const [customers, redemptions] = await Promise.all([
      this.db.prepare(
        `SELECT COUNT(*) AS customer_count,
                COALESCE(SUM(point_balance_units), 0) AS current_point_units
         FROM customers ${customerFilter}`
      ).first<DashboardRow>(),
      this.db.prepare(
        `SELECT redemption_count, cumulative_redeemed_point_units
         FROM lifetime_redemption_snapshots
         ORDER BY redemption_count DESC
         LIMIT 1`
      ).first<RedemptionRow>()
    ]);
    if (customers === null) throw new Error("Dashboard customer totals are unavailable.");
    return {
      customerCount: safeNonnegative(customers.customer_count, "dashboard customer count"),
      currentPointUnits: safeNonnegative(customers.current_point_units, "dashboard point total"),
      lifetimeRedemptionCount: redemptions === null
        ? 0
        : safeNonnegative(redemptions.redemption_count, "lifetime redemption count"),
      lifetimeRedeemedPointUnits: redemptions === null
        ? 0
        : safeNonnegative(
          redemptions.cumulative_redeemed_point_units,
          "lifetime redeemed point total"
        )
    };
  }
}
