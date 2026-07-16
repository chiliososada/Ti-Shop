import "server-only";

import {
  isSafeNavigationLabel,
  parseSafeNavigationUrl,
  type StorefrontNavigationLink,
} from "@/lib/navigation-url";
import { navigationKeySchema } from "@/server/admin/navigation/validators";
import { getDb } from "@/server/db/client";

export async function getPublicNavigation(
  key: string,
): Promise<readonly StorefrontNavigationLink[] | null> {
  const parsedKey = navigationKeySchema.safeParse(key);
  if (!parsedKey.success) return null;

  const navigation = await getDb().navigation.findFirst({
    where: { key: parsedKey.data, status: "PUBLISHED" },
    select: {
      items: {
        where: { parentId: null, isVisible: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        take: 100,
        select: {
          publicId: true,
          label: true,
          url: true,
          openInNewTab: true,
        },
      },
    },
  });
  if (!navigation) return null;

  const links = navigation.items.flatMap((item) => {
    const destination = parseSafeNavigationUrl(item.url);
    if (!destination || !isSafeNavigationLabel(item.label)) return [];
    return [
      {
        id: item.publicId,
        label: item.label,
        href: destination.href,
        external: destination.external,
        openInNewTab: item.openInNewTab,
      },
    ];
  });

  // A published but empty/invalid menu is treated as unavailable. Header and
  // footer components then use their reviewed fixed fallback instead of
  // allowing a bad administrative edit to erase global navigation.
  return links.length > 0 ? links : null;
}
