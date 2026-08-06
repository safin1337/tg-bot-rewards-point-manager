import type { Operation } from "../types/models";
import { addMinutesIso, subtractUtcCalendarMonthsClamped } from "../utils/time";

type ProcessedType = Extract<Operation, "ADD_CUSTOMER" | "PURCHASE" | "MANUAL_ADD" | "REDEEM" | "EXPORT">;
export type ExportProgress = "NONE" | "CUSTOMERS_SENT" | "TRANSACTIONS_SENT" | "BOTH_SENT";

export class IdempotencyRepository {
  constructor(
    private readonly db: D1Database,
    private readonly clock: () => Date = () => new Date()
  ) {}

  private cleanupStatement(now: Date): D1PreparedStatement {
    const nowUtc = now.toISOString();
    const staleProcessingBefore = addMinutesIso(nowUtc, -5);
    const cutoffUtc = subtractUtcCalendarMonthsClamped(now, 2).toISOString();
    return this.db
      .prepare(
        `DELETE FROM processed_updates
         WHERE (
           status != 'PROCESSING'
           OR processed_at_utc < ?
         )
         AND telegram_update_id NOT IN (
           SELECT telegram_update_id
           FROM processed_updates
           WHERE (
             status != 'PROCESSING'
             OR processed_at_utc < ?
           )
             AND processed_at_utc >= ?
           ORDER BY processed_at_utc DESC, telegram_update_id DESC
           LIMIT 40
         )`
      )
      .bind(staleProcessingBefore, staleProcessingBefore, cutoffUtc);
  }

  async cleanup(): Promise<void> {
    await this.cleanupStatement(this.clock()).run();
  }

  async claim(updateId: number, type: ProcessedType): Promise<boolean> {
    const at = this.clock();
    const now = at.toISOString();
    const staleProcessingBefore = addMinutesIso(now, -5);
    const results = await this.db.batch([
      this.db.prepare(
        `INSERT INTO processed_updates (telegram_update_id, update_type, status, processed_at_utc)
         VALUES (?, ?, 'PROCESSING', ?)
         ON CONFLICT(telegram_update_id) DO UPDATE SET
           update_type = excluded.update_type,
           status = 'PROCESSING',
           processed_at_utc = excluded.processed_at_utc
         WHERE processed_updates.status = 'FAILED'
            OR (
              processed_updates.status = 'PROCESSING'
              AND processed_updates.processed_at_utc < ?
            )`
      )
      .bind(updateId, type, now, staleProcessingBefore),
      this.cleanupStatement(at)
    ]);
    return results[0]?.meta.changes === 1;
  }

  async complete(updateId: number): Promise<void> {
    const at = this.clock();
    const results = await this.db.batch([
      this.db.prepare(
        `UPDATE processed_updates SET status = 'COMPLETED', processed_at_utc = ?
         WHERE telegram_update_id = ?`
      )
      .bind(at.toISOString(), updateId),
      this.cleanupStatement(at)
    ]);
    if (results[0]?.meta.changes !== 1) throw new Error("Processed update could not be completed.");
  }

  async getExportProgress(updateId: number): Promise<ExportProgress> {
    const row = await this.db
      .prepare("SELECT export_progress FROM processed_updates WHERE telegram_update_id = ?")
      .bind(updateId)
      .first<{ export_progress: string }>();
    const value = row?.export_progress;
    if (
      value !== "NONE"
      && value !== "CUSTOMERS_SENT"
      && value !== "TRANSACTIONS_SENT"
      && value !== "BOTH_SENT"
    ) {
      throw new Error("Invalid export progress.");
    }
    return value;
  }

  async setExportProgress(updateId: number, progress: ExportProgress): Promise<void> {
    const result = await this.db
      .prepare(
        `UPDATE processed_updates SET export_progress = ?, processed_at_utc = ?
         WHERE telegram_update_id = ? AND update_type = 'EXPORT'`
      )
      .bind(progress, this.clock().toISOString(), updateId)
      .run();
    if (result.meta.changes !== 1) throw new Error("Export progress could not be saved.");
  }

  async fail(updateId: number): Promise<void> {
    const at = this.clock();
    await this.db.batch([
      this.db.prepare(
        `UPDATE processed_updates SET status = 'FAILED', processed_at_utc = ?
         WHERE telegram_update_id = ? AND status = 'PROCESSING'`
      )
      .bind(at.toISOString(), updateId),
      this.cleanupStatement(at)
    ]);
  }
}
