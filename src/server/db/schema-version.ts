// Keep this value equal to the newest Prisma migration directory. The latest
// migration must also persist the same value in application_schema_metadata;
// schema-version.test.ts enforces both sides of that release contract.
export const REQUIRED_APPLICATION_SCHEMA_VERSION =
  "20260715011500_finance_order_number_column";
