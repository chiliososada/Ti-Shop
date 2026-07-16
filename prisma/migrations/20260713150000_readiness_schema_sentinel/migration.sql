CREATE TABLE "app"."application_schema_metadata" (
  "key" VARCHAR(80) NOT NULL,
  "version" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "application_schema_metadata_pkey" PRIMARY KEY ("key")
);

INSERT INTO "app"."application_schema_metadata" (
  "key",
  "version",
  "updated_at"
) VALUES (
  'application',
  '20260713150000_readiness_schema_sentinel',
  CURRENT_TIMESTAMP
);
