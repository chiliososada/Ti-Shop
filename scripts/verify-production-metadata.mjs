const NAMED_ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
});

function decodeHtml(value) {
  if (value === null) return null;

  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/giu,
    (entity, token) => {
      const normalized = token.toLowerCase();
      if (normalized.startsWith("#x")) {
        try {
          return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
        } catch {
          return entity;
        }
      }
      if (normalized.startsWith("#")) {
        try {
          return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
        } catch {
          return entity;
        }
      }
      return NAMED_ENTITIES[normalized] ?? entity;
    },
  );
}

function attributeFrom(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = tag.match(
    new RegExp(
      `(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "iu",
    ),
  );
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? null);
}

function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "giu"))].map(
    (match) => match[0],
  );
}

function metaContent(html, attribute, value) {
  const tag = tags(html, "meta").find(
    (candidate) => attributeFrom(candidate, attribute)?.toLowerCase() === value,
  );
  return tag ? attributeFrom(tag, "content") : null;
}

function canonicalFrom(html) {
  const tag = tags(html, "link").find((candidate) =>
    (attributeFrom(candidate, "rel") ?? "")
      .toLowerCase()
      .split(/\s+/u)
      .includes("canonical"),
  );
  return tag ? attributeFrom(tag, "href") : null;
}

function titleFrom(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu);
  return decodeHtml(match?.[1] ?? null);
}

function absoluteUrl(value) {
  if (!value) return null;
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

export function inspectProductionMetadata(html) {
  return {
    title: titleFrom(html),
    description: metaContent(html, "name", "description"),
    canonical: canonicalFrom(html),
    openGraphTitle: metaContent(html, "property", "og:title"),
    openGraphDescription: metaContent(html, "property", "og:description"),
    openGraphUrl: metaContent(html, "property", "og:url"),
  };
}

export function productionMetadataFailures(html, expectedCanonical) {
  const metadata = inspectProductionMetadata(html);
  const failures = [];
  const canonical = absoluteUrl(metadata.canonical);
  const expected = absoluteUrl(expectedCanonical);
  const openGraphUrl = absoluteUrl(metadata.openGraphUrl);

  if (!metadata.title) failures.push("missing title");
  if (!metadata.description) failures.push("missing description");
  if (!metadata.canonical) {
    failures.push("missing canonical");
  } else if (!canonical) {
    failures.push(`invalid canonical ${metadata.canonical}`);
  } else if (!expected || canonical !== expected) {
    failures.push(`canonical ${metadata.canonical}`);
  }

  if (!metadata.openGraphTitle) {
    failures.push("missing og:title");
  } else if (metadata.title && metadata.openGraphTitle !== metadata.title) {
    failures.push("og:title does not match title");
  }

  if (!metadata.openGraphDescription) {
    failures.push("missing og:description");
  } else if (
    metadata.description &&
    metadata.openGraphDescription !== metadata.description
  ) {
    failures.push("og:description does not match description");
  }

  if (!metadata.openGraphUrl) {
    failures.push("missing og:url");
  } else if (!openGraphUrl) {
    failures.push(`invalid og:url ${metadata.openGraphUrl}`);
  } else if (canonical && openGraphUrl !== canonical) {
    failures.push("og:url does not match canonical");
  }

  return failures;
}
