import type { Operation } from "../types/models";
import { addMinutesIso, nowIso } from "../utils/time";

type ProcessedType = Extract<Operation, "ADD_CUSTOMER" | "PURCHASE" | "MANUAL_ADD" | "REDEEM" | "EXPORT">;
export type ExportProgress = "NONE" | "CUSTOMERS_SENT" | "TRANSACTIONS_SENT" | "BOTH_SENT";

export class IdempotencyRepository {
  constructor(private readonly db: D1Database) {}

  async claim(updateId: number, type: ProcessedType): Promise<boolean> {
    const now = nowIso();
    const staleProcessingBefore = addMinutesIso(now, -5);
    const result = await this.db
      .prepare(
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
      .bind(updateId, type, now, staleProcessingBefore)
      .run();
    return result.meta.changes === 1;
  }

  async complete(updateId: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE processed_updates SET status = 'COMPLETED', processed_at_utc = ?
         WHERE telegram_update_id = ?`
      )
      .bind(nowIso(), updateId)
      .run();
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
      .bind(progress, nowIso(), updateId)
      .run();
    if (result.meta.changes !== 1) throw new Error("Export progress could not be saved.");
  }

  async fail(updateId: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE processed_updates SET status = 'FAILED', processed_at_utc = ?
         WHERE telegram_update_id = ? AND status = 'PROCESSING'`
      )
      .bind(nowIso(), updateId)
      .run();
  }
}
