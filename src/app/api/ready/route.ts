import {
  getAuthRuntimeEnv,
  getDatabaseRuntimeEnv,
} from "@/server/config/runtime-env";
import { getDb } from "@/server/db/client";
import { REQUIRED_APPLICATION_SCHEMA_VERSION } from "@/server/db/schema-version";
import { getNowPaymentsRuntimeConfig } from "@/server/payments/nowpayments/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
};

type ReadinessSchemaRow = {
  version: string;
};

export async function GET() {
  try {
    getAuthRuntimeEnv();
    getDatabaseRuntimeEnv();
    getNowPaymentsRuntimeConfig();
    const schemaRows = await getDb().$queryRaw<ReadinessSchemaRow[]>`
      SELECT metadata.version
      FROM app.application_schema_metadata AS metadata
      WHERE metadata.key = 'application'
        AND EXISTS (
          SELECT 1
          FROM app.site_settings AS settings
          WHERE settings.key = 'commerce.default_currency'
        )
    `;

    if (
      schemaRows.length !== 1 ||
      schemaRows[0]?.version !== REQUIRED_APPLICATION_SCHEMA_VERSION
    ) {
      throw new Error("The application database schema is not ready.");
    }

    return Response.json(
      { status: "ready" },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    console.error("Readiness check failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });

    return Response.json(
      { status: "not_ready" },
      {
        status: 503,
        headers: {
          ...noStoreHeaders,
          "Retry-After": "5",
        },
      },
    );
  }
}
