import type { Env as WorkerEnv } from "./src/env";
import type * as WorkerModule from "./src/index";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }

    interface GlobalProps {
      mainModule: typeof WorkerModule;
    }
  }
}

export {};
