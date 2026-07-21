import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import sharp from "sharp";

import { PrismaClient } from "../src/generated/prisma/client";
import { validatePostgresConnectionUrl } from "../src/lib/postgres-connection-url";

type DimensionUpdate = {
  id: bigint;
  storageKey: string;
  width: number;
  height: number;
};

function localPublicPath(projectRoot: string, publicUrl: string): string {
  if (!publicUrl.startsWith("/") || publicUrl.includes("\0")) {
    throw new Error(`Media URL is not a safe local public path: ${publicUrl}`);
  }

  const publicRoot = resolve(projectRoot, "public");
  const absolutePath = resolve(publicRoot, `.${publicUrl}`);
  if (absolutePath !== publicRoot && !absolutePath.startsWith(`${publicRoot}${sep}`)) {
    throw new Error(`Media URL escapes the public directory: ${publicUrl}`);
  }
  return absolutePath;
}

async function main(): Promise<void> {
  const rawConnectionUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!rawConnectionUrl) {
    throw new Error("DIRECT_URL or DATABASE_URL is required.");
  }
  const connectionString = validatePostgresConnectionUrl(rawConnectionUrl, {
    label: process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL",
    requiredSchema: "app",
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const projectRoot = resolve(import.meta.dirname, "..");

  try {
    const mediaRows = await prisma.media.findMany({
      where: {
        kind: "IMAGE",
        storageProvider: "local-public",
        deletedAt: null,
        OR: [{ width: null }, { height: null }],
      },
      orderBy: { id: "asc" },
      select: { id: true, storageKey: true, publicUrl: true },
    });

    const updates: DimensionUpdate[] = [];
    for (const media of mediaRows) {
      if (!media.publicUrl) {
        throw new Error(`Local media has no public URL: ${media.storageKey}`);
      }
      const bytes = await readFile(localPublicPath(projectRoot, media.publicUrl));
      const metadata = await sharp(bytes).metadata();
      if (
        !Number.isSafeInteger(metadata.width) ||
        !Number.isSafeInteger(metadata.height) ||
        metadata.width! <= 0 ||
        metadata.height! <= 0
      ) {
        throw new Error(`Image dimensions could not be read: ${media.publicUrl}`);
      }
      updates.push({
        id: media.id,
        storageKey: media.storageKey,
        width: metadata.width!,
        height: metadata.height!,
      });
    }

    await prisma.$transaction(
      updates.map((media) =>
        prisma.media.update({
          where: { id: media.id },
          data: { width: media.width, height: media.height },
          select: { id: true },
        }),
      ),
    );

    const dimensions = Object.entries(
      updates.reduce<Record<string, number>>((counts, media) => {
        const key = `${media.width}x${media.height}`;
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {}),
    ).map(([size, count]) => ({ size, count }));

    process.stdout.write(
      `${JSON.stringify({ status: "ok", updated: updates.length, dimensions }, null, 2)}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown media backfill error.";
  process.stderr.write(`${JSON.stringify({ status: "failed", message })}\n`);
  process.exitCode = 1;
});
