import "server-only";

import { publicIdSchema } from "@/server/admin/audit/validation";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";

const ADMIN_NAVIGATION_LIMIT = 100;

export async function getAdminNavigationIndex() {
  await requirePermission("content.read", "/admin/content/navigation");
  const db = getDb();
  const [total, navigations] = await Promise.all([
    db.navigation.count(),
    db.navigation.findMany({
      orderBy: [{ key: "asc" }, { id: "asc" }],
      take: ADMIN_NAVIGATION_LIMIT,
      select: {
        publicId: true,
        key: true,
        name: true,
        status: true,
        updatedAt: true,
        _count: { select: { items: true } },
      },
    }),
  ]);

  return {
    total,
    truncated: total > navigations.length,
    navigations: navigations.map((navigation) => ({
      publicId: navigation.publicId,
      key: navigation.key,
      name: navigation.name,
      status: navigation.status,
      itemCount: navigation._count.items,
      updatedAt: navigation.updatedAt.toISOString(),
    })),
  };
}

export async function getAdminNavigation(publicId: string) {
  await requirePermission(
    "content.read",
    `/admin/content/navigation/${encodeURIComponent(publicId)}`,
  );
  const parsedId = publicIdSchema.safeParse(publicId);
  if (!parsedId.success) return null;

  const navigation = await getDb().navigation.findUnique({
    where: { publicId: parsedId.data },
    select: {
      id: true,
      publicId: true,
      key: true,
      name: true,
      status: true,
      updatedAt: true,
      items: {
        where: { parentId: null },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        take: ADMIN_NAVIGATION_LIMIT,
        select: {
          publicId: true,
          label: true,
          url: true,
          position: true,
          isVisible: true,
          openInNewTab: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!navigation) return null;

  const [topLevelCount, nestedCount] = await Promise.all([
    getDb().navigationItem.count({
      where: { navigationId: navigation.id, parentId: null },
    }),
    getDb().navigationItem.count({
      where: { navigationId: navigation.id, parentId: { not: null } },
    }),
  ]);

  return {
    publicId: navigation.publicId,
    key: navigation.key,
    name: navigation.name,
    status: navigation.status,
    updatedAt: navigation.updatedAt.toISOString(),
    topLevelCount,
    nestedCount,
    truncated: topLevelCount > navigation.items.length,
    items: navigation.items.map((item) => ({
      ...item,
      updatedAt: item.updatedAt.toISOString(),
    })),
  };
}

