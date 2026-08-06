import type { AppConfig } from "../env";
import { RewardMutationService } from "../application/mutation-service";
import { CustomerRepository } from "../database/customer-repository";
import { IdempotencyRepository } from "../database/idempotency-repository";
import { LeaderboardRepository } from "../database/leaderboard-repository";
import { StateRepository } from "../database/state-repository";
import { TransactionRepository } from "../database/transaction-repository";
import { ExportService } from "../exports/export-service";
import { TelegramClient } from "../telegram/client";

export interface WorkflowContext {
  config: AppConfig;
  db: D1Database;
  telegram: TelegramClient;
  customers: CustomerRepository;
  transactions: TransactionRepository;
  states: StateRepository;
  idempotency: IdempotencyRepository;
  leaderboards: LeaderboardRepository;
  mutations: RewardMutationService;
  exports: ExportService;
}

export const makeWorkflowContext = (
  db: D1Database,
  config: AppConfig,
  fetcher: typeof fetch = fetch
): WorkflowContext => ({
  config,
  db,
  telegram: new TelegramClient(config.botToken, fetcher),
  customers: new CustomerRepository(db),
  transactions: new TransactionRepository(db),
  states: new StateRepository(db, config.stateTtlMinutes),
  idempotency: new IdempotencyRepository(db),
  leaderboards: new LeaderboardRepository(db),
  mutations: new RewardMutationService(db),
  exports: new ExportService(db, config.exportMaxRows, config.exportMaxBytes)
});
