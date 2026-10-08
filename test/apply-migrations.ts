import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Setup file for the worker and worker-ws projects: applies migrations/*.sql to the
// test D1 database. applyD1Migrations is idempotent.
const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS;
await applyD1Migrations(env.DB, migrations);
