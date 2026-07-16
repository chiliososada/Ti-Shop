import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getDatabaseRuntimeEnv } from "@/server/config/runtime-env";

type DatabaseState = {
  client: PrismaClient;
  pool: Pool;
};

const globalDatabase = globalThis as typeof globalThis & {
  __tiShopDatabase?: DatabaseState;
};

function createDatabaseState(): DatabaseState {
  const env = getDatabaseRuntimeEnv();
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT_MS,
    maxLifetimeSeconds: env.DB_POOL_MAX_LIFETIME_SECONDS,
    keepAlive: true,
    application_name: "ti-shop-web",
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 10_000,
  });

  const adapter = new PrismaPg(pool, {
    schema: "app",
    disposeExternalPool: true,
    onPoolError(error) {
      console.error("An idle PostgreSQL connection failed.", {
        name: error.name,
        message: error.message,
      });
    },
  });

  return {
    client: new PrismaClient({ adapter }),
    pool,
  };
}

function getDatabaseState() {
  globalDatabase.__tiShopDatabase ??= createDatabaseState();
  return globalDatabase.__tiShopDatabase;
}

/**
 * Returns the process-wide Prisma client. Initialization is deliberately lazy
 * so static Next.js builds never need database credentials.
 */
export function getDb() {
  return getDatabaseState().client;
}

export async function disconnectDb() {
  const state = globalDatabase.__tiShopDatabase;
  if (!state) {
    return;
  }

  await state.client.$disconnect();
  globalDatabase.__tiShopDatabase = undefined;
}
