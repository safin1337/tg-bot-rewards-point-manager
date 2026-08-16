import type { Env as WorkerEnv } from "./src/env";
import type * as WorkerModule from "./src/index";
import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      MIGRATION_DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }

    interface GlobalProps {
      mainModule: typeof WorkerModule;
    }
  }
}

export {};
