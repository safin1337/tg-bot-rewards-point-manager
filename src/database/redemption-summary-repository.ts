export class RedemptionSummaryRepository {
  constructor(private readonly db: D1Database) {}

  recordStatement(
    telegramUpdateId: number,
    redeemedPointUnits: number,
    recordedAtUtc: string
  ): D1PreparedStatement {
    return this.db.prepare(
      `INSERT INTO lifetime_redemption_snapshots (
         telegram_update_id, redemption_count, redeemed_point_units,
         cumulative_redeemed_point_units, recorded_at_utc
       )
       SELECT
         ?,
         COALESCE((SELECT redemption_count FROM lifetime_redemption_snapshots
                   ORDER BY redemption_count DESC LIMIT 1), 0) + 1,
         ?,
         COALESCE((SELECT cumulative_redeemed_point_units
                   FROM lifetime_redemption_snapshots
                   ORDER BY redemption_count DESC LIMIT 1), 0) + ?,
         ?`
    ).bind(telegramUpdateId, redeemedPointUnits, redeemedPointUnits, recordedAtUtc);
  }

  pruneStatement(): D1PreparedStatement {
    return this.db.prepare(
      `DELETE FROM lifetime_redemption_snapshots
       WHERE telegram_update_id NOT IN (
         SELECT telegram_update_id
         FROM lifetime_redemption_snapshots
         ORDER BY redemption_count DESC
         LIMIT 40
       )`
    );
  }

  guardStatement(
    telegramUpdateId: number,
    redeemedPointUnits: number
  ): D1PreparedStatement {
    return this.db.prepare(
      `INSERT INTO lifetime_redemption_snapshots (
         telegram_update_id, redemption_count, redeemed_point_units,
         cumulative_redeemed_point_units, recorded_at_utc
       )
       SELECT ?, 0, 0, 0, ''
       WHERE NOT EXISTS (
         SELECT 1 FROM lifetime_redemption_snapshots
         WHERE telegram_update_id = ?
           AND redeemed_point_units = ?
           AND redemption_count = (
             SELECT MAX(redemption_count) FROM lifetime_redemption_snapshots
           )
       ) OR (SELECT COUNT(*) FROM lifetime_redemption_snapshots) > 40`
    ).bind(telegramUpdateId, telegramUpdateId, redeemedPointUnits);
  }
}
