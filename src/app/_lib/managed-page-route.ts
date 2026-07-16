import "server-only";

import type { Metadata } from "next";
import { connection } from "next/server";

import type { PublicSearchParams } from "@/app/_lib/public-seo";
import { createManagedPageMetadata } from "@/lib/managed-page-metadata";
import {
  getManagedPageDefinition,
  type ManagedPageRouteKey,
} from "@/lib/managed-page-routes";
import { getPublicManagedPage } from "@/server/content";

export type ManagedPageRouteProps = {
  searchParams: Promise<PublicSearchParams>;
};

function requiredDefinition(routeKey: ManagedPageRouteKey) {
  const definition = getManagedPageDefinition(routeKey);
  if (!definition) throw new Error(`Missing managed page route: ${routeKey}`);
  return definition;
}

export async function generateManagedPageRouteMetadata(
  routeKey: ManagedPageRouteKey,
  searchParams: Promise<PublicSearchParams>,
): Promise<Metadata> {
  await connection();
  const [page, query] = await Promise.all([
    getPublicManagedPage(routeKey),
    searchParams,
  ]);
  return createManagedPageMetadata(requiredDefinition(routeKey), page, query);
}

export async function getManagedPageRouteData(routeKey: ManagedPageRouteKey) {
  await connection();
  return {
    definition: requiredDefinition(routeKey),
    page: await getPublicManagedPage(routeKey),
  };
}
