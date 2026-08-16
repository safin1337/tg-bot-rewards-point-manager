import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll } from "vitest";

beforeAll(async () => {
  // Cloudflare supplies this serialized test-only binding from readD1Migrations().
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
