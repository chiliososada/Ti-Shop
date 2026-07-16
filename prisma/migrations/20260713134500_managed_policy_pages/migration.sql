CREATE TYPE "app"."managed_page_route" AS ENUM (
  'about',
  'shipping',
  'returns_and_refunds',
  'privacy_policy',
  'terms_of_service',
  'payment_policy',
  'research_use_policy'
);

ALTER TABLE "app"."pages"
  ADD COLUMN "managed_route" "app"."managed_page_route";

CREATE UNIQUE INDEX "pages_managed_route_key"
  ON "app"."pages"("managed_route");

ALTER TABLE "app"."pages"
  ADD CONSTRAINT "pages_managed_route_format_check"
  CHECK ("managed_route" IS NULL OR "format" = 'markdown');
