export type SniffedImageFormat = {
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
  extension: "jpg" | "png" | "webp" | "avif";
};

function hasPrefix(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false;
  return prefix.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Magic-number sniffing for the four supported raster formats. Content — not
 * the client-declared MIME type or filename — decides what a file is; SVG,
 * HTML, scripts, and executables all fail this check by construction.
 */
export function sniffImageFormat(bytes: Uint8Array): SniffedImageFormat | null {
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  // ISO-BMFF: size(4) + "ftyp" + major brand. Accept avif/avis major brands.
  if (
    asciiAt(bytes, 4, "ftyp") &&
    (asciiAt(bytes, 8, "avif") || asciiAt(bytes, 8, "avis"))
  ) {
    return { mimeType: "image/avif", extension: "avif" };
  }
  return null;
}

export type UploadValidationFailure = {
  code:
    | "empty_file"
    | "file_too_large"
    | "type_not_allowed"
    | "content_mismatch"
    | "not_an_image";
  message: string;
};

export type UploadValidationInput = {
  bytes: Uint8Array;
  declaredMimeType: string | null;
  originalFilename: string | null;
  maxBytes: number;
  allowedTypes: ReadonlySet<string>;
};

export type UploadValidationSuccess = {
  ok: true;
  sniffed: SniffedImageFormat;
  originalFilename: string | null;
};

export function validateUploadedImage(
  input: UploadValidationInput,
): UploadValidationSuccess | ({ ok: false } & UploadValidationFailure) {
  if (input.bytes.length === 0) {
    return { ok: false, code: "empty_file", message: "The uploaded file is empty." };
  }
  if (input.bytes.length > input.maxBytes) {
    return {
      ok: false,
      code: "file_too_large",
      message: `The file exceeds the ${Math.floor(input.maxBytes / (1024 * 1024))} MB upload limit.`,
    };
  }

  const sniffed = sniffImageFormat(input.bytes);
  if (!sniffed) {
    return {
      ok: false,
      code: "not_an_image",
      message:
        "The file content is not a supported raster image (JPEG, PNG, WebP, or AVIF).",
    };
  }
  if (!input.allowedTypes.has(sniffed.mimeType)) {
    return {
      ok: false,
      code: "type_not_allowed",
      message: `${sniffed.mimeType} uploads are not enabled.`,
    };
  }

  const declared = input.declaredMimeType?.trim().toLowerCase() ?? null;
  if (
    declared !== null &&
    declared !== "" &&
    declared !== "application/octet-stream" &&
    declared !== sniffed.mimeType &&
    // Browsers commonly declare image/jpg; treat it as image/jpeg.
    !(declared === "image/jpg" && sniffed.mimeType === "image/jpeg")
  ) {
    return {
      ok: false,
      code: "content_mismatch",
      message: `The file claims ${declared} but its content is ${sniffed.mimeType}.`,
    };
  }

  return {
    ok: true,
    sniffed,
    originalFilename: sanitizeOriginalFilename(input.originalFilename),
  };
}

/**
 * The original filename is retained as metadata only — object keys never use
 * it. Strip directories, control characters, and pathological lengths.
 */
export function sanitizeOriginalFilename(value: string | null): string | null {
  if (!value) return null;
  const basename = value.split(/[\\/]/u).pop() ?? "";
  const cleaned = basename
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return null;
  return cleaned.length > 255 ? cleaned.slice(0, 255) : cleaned;
}
