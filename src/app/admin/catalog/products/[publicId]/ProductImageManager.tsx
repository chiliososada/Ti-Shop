"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  deleteProductImagesAction,
  reorderProductImagesAction,
  setPrimaryProductImageAction,
  updateProductImageTextAction,
} from "@/app/admin/catalog/product-image-actions";

export type ManagedProductImage = {
  mediaPublicId: string;
  role: "PRIMARY" | "GALLERY";
  position: number;
  altText: string | null;
  title: string | null;
  originalFilename: string | null;
  width: number | null;
  height: number | null;
  uploadStatus: "UPLOADING" | "READY" | "FAILED";
  urls: { original: string; thumb: string; card: string; detail: string } | null;
};

type StorageInfo =
  | {
      configured: true;
      maxBytes: number;
      allowedTypes: string[];
      maxImagesPerProduct: number;
    }
  | { configured: false; reason: string };

type UploadItem = {
  id: string;
  fileName: string;
  sizeBytes: number;
  progress: number;
  status: "queued" | "uploading" | "done" | "failed" | "canceled";
  message: string | null;
  retryable: boolean;
  file: File;
  xhr: XMLHttpRequest | null;
};

const MAX_PARALLEL_UPLOADS = 3;

const cardClass =
  "rounded-2xl border border-ink-900/[0.08] bg-surface p-4";
const buttonClass =
  "rounded-lg border border-ink-900/15 bg-white px-3 py-1.5 text-xs font-semibold text-strong transition hover:border-sage-600 disabled:cursor-not-allowed disabled:opacity-50";
const dangerButtonClass =
  "rounded-lg border border-red-800/30 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 transition hover:border-red-800 disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClass =
  "rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-50";
const inputClass =
  "w-full rounded-lg border border-ink-900/15 bg-white px-3 py-2 text-xs text-strong outline-none focus:border-sage-600";

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function ProductImageManager({
  productPublicId,
  initialImages,
  storage,
}: {
  productPublicId: string;
  initialImages: ManagedProductImage[];
  storage: StorageInfo;
}) {
  const router = useRouter();
  const [images, setImages] = useState<ManagedProductImage[]>(initialImages);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [textDrafts, setTextDrafts] = useState<Record<string, { altText: string; title: string }>>({});
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [isMutating, startMutation] = useTransition();
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  // Imperative upload scheduling: the waiting line and in-flight count live in
  // refs so event handlers (not effects) drive the queue.
  const waitingRef = useRef<UploadItem[]>([]);
  const inFlightRef = useRef(0);

  // The server list is the source of truth; refresh() re-renders the page and
  // hands us new props after every committed mutation. Local edit state is
  // reset when the server payload changes (React's adjust-state-on-prop-change
  // pattern).
  const serverKey = useMemo(() => JSON.stringify(initialImages), [initialImages]);
  const [lastServerKey, setLastServerKey] = useState(serverKey);
  if (lastServerKey !== serverKey) {
    setLastServerKey(serverKey);
    setImages(initialImages);
    setPendingOrder(null);
    setSelection(new Set());
    setTextDrafts({});
  }

  const hasActiveUploads = uploads.some(
    (item) => item.status === "queued" || item.status === "uploading",
  );
  const hasUnsavedText = Object.keys(textDrafts).length > 0;
  const dirty = pendingOrder !== null || hasActiveUploads || hasUnsavedText;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const orderedImages = useMemo(() => {
    if (!pendingOrder) return images;
    const byId = new Map(images.map((image) => [image.mediaPublicId, image]));
    return pendingOrder
      .map((id) => byId.get(id))
      .filter((image): image is ManagedProductImage => Boolean(image));
  }, [images, pendingOrder]);

  const updateUpload = useCallback((id: string, patch: Partial<UploadItem>) => {
    setUploads((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const startUploadRef = useRef<(item: UploadItem) => void>(() => {});

  const pumpQueue = useCallback(() => {
    while (inFlightRef.current < MAX_PARALLEL_UPLOADS) {
      const next = waitingRef.current.shift();
      if (!next) break;
      inFlightRef.current += 1;
      startUploadRef.current(next);
    }
  }, []);

  const startUpload = useCallback(
    (item: UploadItem) => {
      const settle = () => {
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
        pumpQueue();
      };
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", item.file, item.fileName);
      xhr.open("POST", `/api/admin/products/${productPublicId}/images`);
      xhr.responseType = "json";
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          updateUpload(item.id, {
            progress: Math.min(99, Math.round((event.loaded / event.total) * 100)),
          });
        }
      });
      xhr.addEventListener("load", () => {
        const body = xhr.response as
          | { ok: true; image: ManagedProductImage; deduplicated: boolean }
          | { ok: false; message?: string; retryable?: boolean }
          | null;
        if (xhr.status === 201 && body && "ok" in body && body.ok) {
          updateUpload(item.id, {
            status: "done",
            progress: 100,
            message: body.deduplicated
              ? "Identical file already attached — reused the existing image."
              : null,
            xhr: null,
          });
          setImages((current) =>
            current.some((image) => image.mediaPublicId === body.image.mediaPublicId)
              ? current
              : [...current, body.image],
          );
          router.refresh();
        } else {
          updateUpload(item.id, {
            status: "failed",
            message:
              (body && "message" in body && body.message) ||
              `Upload failed (HTTP ${xhr.status}).`,
            retryable: Boolean(body && "retryable" in body && body.retryable) || xhr.status >= 500,
            xhr: null,
          });
        }
        settle();
      });
      xhr.addEventListener("error", () => {
        updateUpload(item.id, {
          status: "failed",
          message: "Network interruption — the upload did not complete.",
          retryable: true,
          xhr: null,
        });
        settle();
      });
      xhr.addEventListener("abort", () => {
        updateUpload(item.id, {
          status: "canceled",
          message: "Upload canceled.",
          retryable: true,
          xhr: null,
        });
        settle();
      });
      updateUpload(item.id, { status: "uploading", progress: 0, message: null, xhr });
      xhr.send(formData);
    },
    [productPublicId, router, updateUpload, pumpQueue],
  );

  useEffect(() => {
    startUploadRef.current = startUpload;
  }, [startUpload]);

  const enqueueFiles = useCallback(
    (files: FileList | File[]) => {
      if (!storage.configured) return;
      setBanner(null);
      const list = [...files];
      const problems: string[] = [];
      const accepted: UploadItem[] = [];
      const activeCount = inFlightRef.current + waitingRef.current.length;
      let remainingSlots =
        storage.maxImagesPerProduct - images.length - activeCount;

      for (const file of list) {
        if (remainingSlots <= 0) {
          problems.push(
            `“${file.name}” skipped — a product can hold at most ${storage.maxImagesPerProduct} images.`,
          );
          continue;
        }
        if (file.size === 0) {
          problems.push(`“${file.name}” skipped — the file is empty.`);
          continue;
        }
        if (file.size > storage.maxBytes) {
          problems.push(
            `“${file.name}” skipped — larger than ${formatBytes(storage.maxBytes)}.`,
          );
          continue;
        }
        if (file.type && !storage.allowedTypes.includes(file.type.toLowerCase()) && file.type.toLowerCase() !== "image/jpg") {
          problems.push(
            `“${file.name}” skipped — ${file.type} is not an accepted image type.`,
          );
          continue;
        }
        remainingSlots -= 1;
        accepted.push({
          id: crypto.randomUUID(),
          fileName: file.name,
          sizeBytes: file.size,
          progress: 0,
          status: "queued",
          message: null,
          retryable: false,
          file,
          xhr: null,
        });
      }
      if (problems.length > 0) {
        setBanner({ tone: "error", text: problems.join(" ") });
      }
      if (accepted.length > 0) {
        setUploads((current) => [...current, ...accepted]);
        waitingRef.current.push(...accepted);
        pumpQueue();
      }
    },
    [images.length, storage, pumpQueue],
  );

  const runAction = useCallback(
    (work: () => Promise<{ ok: boolean; message?: string; skipped?: { mediaPublicId: string; reason: string }[] }>, successText: string) => {
      setBanner(null);
      startMutation(async () => {
        try {
          const result = await work();
          if (!result.ok) {
            setBanner({ tone: "error", text: result.message ?? "The change failed." });
            return;
          }
          const skippedNote = result.skipped?.length
            ? ` ${result.skipped.map((entry) => entry.reason).join(" ")}`
            : "";
          setBanner({ tone: "success", text: `${successText}${skippedNote}` });
          router.refresh();
        } catch {
          setBanner({
            tone: "error",
            text: "The request did not reach the server. Check the connection and try again.",
          });
        }
      });
    },
    [router, startMutation],
  );

  const moveImage = (from: number, to: number) => {
    const order = (pendingOrder ?? orderedImages.map((image) => image.mediaPublicId)).slice();
    if (to < 0 || to >= order.length) return;
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    setPendingOrder(order);
  };

  const openDeleteDialog = (ids: string[]) => {
    setConfirmDelete(ids);
    dialogRef.current?.showModal();
  };

  const closeDeleteDialog = () => {
    dialogRef.current?.close();
    setConfirmDelete(null);
  };

  const confirmDeletion = () => {
    const ids = confirmDelete ?? [];
    closeDeleteDialog();
    if (ids.length === 0) return;
    runAction(
      () => deleteProductImagesAction({ productPublicId, mediaPublicIds: ids }),
      ids.length > 1 ? `Deleted ${ids.length} images.` : "Image deleted.",
    );
  };

  if (!storage.configured) {
    return (
      <div className="rounded-2xl border border-amber-700/30 bg-amber-50 p-6" role="status">
        <h3 className="text-h5 text-strong">Image uploads unavailable</h3>
        <p className="mt-2 text-sm text-muted">{storage.reason}</p>
        <p className="mt-2 text-xs text-muted">
          Existing images keep working. Configure the STORAGE_* environment and
          restart the application to enable uploads.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {banner ? (
        <p
          role={banner.tone === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            banner.tone === "error"
              ? "rounded-xl border border-red-800/30 bg-red-50 px-4 py-3 text-sm text-red-900"
              : "rounded-xl border border-sage-700/30 bg-sage-50 px-4 py-3 text-sm text-sage-900"
          }
        >
          {banner.text}
        </p>
      ) : null}

      <div
        className="rounded-2xl border-2 border-dashed border-ink-900/15 bg-white p-6 text-center transition data-[dragging=true]:border-sage-600"
        onDragOver={(event) => {
          event.preventDefault();
          event.currentTarget.dataset.dragging = "true";
        }}
        onDragLeave={(event) => {
          event.currentTarget.dataset.dragging = "false";
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.currentTarget.dataset.dragging = "false";
          if (event.dataTransfer.files.length > 0) {
            enqueueFiles(event.dataTransfer.files);
          }
        }}
      >
        <p className="text-sm font-semibold text-strong">
          Drag images here, or
          <button
            type="button"
            className="ml-2 inline rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-700"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose files
          </button>
        </p>
        <p className="mt-2 text-xs text-muted">
          JPEG, PNG, WebP, or AVIF · up to {formatBytes(storage.maxBytes)} each · at
          most {storage.maxImagesPerProduct} images per product. Files are
          re-encoded to WebP renditions; metadata (EXIF/GPS) is removed.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept={storage.allowedTypes.join(",")}
          multiple
          className="sr-only"
          aria-label="Choose product images to upload"
          onChange={(event) => {
            if (event.target.files?.length) enqueueFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {uploads.length > 0 ? (
        <ul className="space-y-2" aria-label="Upload queue">
          {uploads.map((item) => (
            <li key={item.id} className={`${cardClass} flex items-center gap-4`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-strong">
                  {item.fileName}
                  <span className="ml-2 font-normal text-muted">{formatBytes(item.sizeBytes)}</span>
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <progress
                    className="h-2 w-full max-w-xs"
                    max={100}
                    value={item.progress}
                    aria-label={`Upload progress for ${item.fileName}`}
                  />
                  <span className="text-xs text-muted">
                    {item.status === "queued" && "Waiting…"}
                    {item.status === "uploading" && `${item.progress}%`}
                    {item.status === "done" && "Uploaded"}
                    {item.status === "failed" && "Failed"}
                    {item.status === "canceled" && "Canceled"}
                  </span>
                </div>
                {item.message ? (
                  <p
                    className={`mt-1 text-xs ${item.status === "failed" ? "text-red-800" : "text-muted"}`}
                    role={item.status === "failed" ? "alert" : undefined}
                  >
                    {item.message}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                {item.status === "uploading" || item.status === "queued" ? (
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      if (item.xhr) {
                        item.xhr.abort();
                      } else {
                        waitingRef.current = waitingRef.current.filter(
                          (entry) => entry.id !== item.id,
                        );
                        updateUpload(item.id, {
                          status: "canceled",
                          message: "Upload canceled.",
                          retryable: true,
                        });
                      }
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
                {(item.status === "failed" && item.retryable) || item.status === "canceled" ? (
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      updateUpload(item.id, { status: "queued", progress: 0, message: null });
                      waitingRef.current.push({ ...item, status: "queued", progress: 0, message: null });
                      pumpQueue();
                    }}
                  >
                    Retry
                  </button>
                ) : null}
                {item.status === "done" || item.status === "failed" || item.status === "canceled" ? (
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() =>
                      setUploads((current) => current.filter((entry) => entry.id !== item.id))
                    }
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {orderedImages.length === 0 && uploads.length === 0 ? (
        <p className={`${cardClass} text-sm text-muted`}>
          No uploaded images yet. The storefront falls back to legacy media
          references below until images are uploaded here.
        </p>
      ) : null}

      {orderedImages.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-muted">
              {orderedImages.length} of {storage.maxImagesPerProduct} images ·
              order is saved explicitly.
            </p>
            {pendingOrder ? (
              <>
                <button
                  type="button"
                  className={primaryButtonClass}
                  disabled={isMutating}
                  onClick={() =>
                    runAction(
                      () =>
                        reorderProductImagesAction({
                          productPublicId,
                          orderedMediaPublicIds: pendingOrder,
                        }),
                      "Image order saved.",
                    )
                  }
                >
                  {isMutating ? "Saving…" : "Save order"}
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={isMutating}
                  onClick={() => setPendingOrder(null)}
                >
                  Cancel reorder
                </button>
              </>
            ) : null}
            {selection.size > 0 ? (
              <button
                type="button"
                className={dangerButtonClass}
                disabled={isMutating}
                onClick={() => openDeleteDialog([...selection])}
              >
                Delete selected ({selection.size})
              </button>
            ) : null}
          </div>

          <ul className="grid gap-4 md:grid-cols-2" aria-label="Product images">
            {orderedImages.map((image, index) => {
              const draft = textDrafts[image.mediaPublicId];
              const altValue = draft?.altText ?? image.altText ?? "";
              const titleValue = draft?.title ?? image.title ?? "";
              const isSelected = selection.has(image.mediaPublicId);
              return (
                <li
                  key={image.mediaPublicId}
                  className={`${cardClass} ${dragIndex === index ? "opacity-60" : ""}`}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragEnd={() => setDragIndex(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragIndex !== null && dragIndex !== index) {
                      moveImage(dragIndex, index);
                    }
                    setDragIndex(null);
                  }}
                >
                  <div className="flex items-start gap-4">
                    <div className="relative shrink-0">
                      {image.urls ? (
                        // Admin previews intentionally bypass the optimizer to
                        // show exactly what is stored.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={image.urls.thumb}
                          alt={image.altText ?? image.originalFilename ?? "Product image"}
                          width={96}
                          height={96}
                          className="h-24 w-24 rounded-xl border border-ink-900/10 object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-24 w-24 items-center justify-center rounded-xl border border-ink-900/10 bg-ink-900/5 text-xs text-muted">
                          No preview
                        </div>
                      )}
                      {image.role === "PRIMARY" ? (
                        <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-ink-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                          Primary
                        </span>
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-muted">
                          {image.originalFilename ??
                            image.urls?.original.split("/").pop() ??
                            "image"}
                          {image.width && image.height ? ` · ${image.width}×${image.height}` : ""}
                          {image.uploadStatus !== "READY" ? ` · ${image.uploadStatus.toLowerCase()}` : ""}
                        </p>
                        <label className="flex items-center gap-1 text-xs text-muted">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            aria-label={`Select ${image.originalFilename ?? "image"} for batch actions`}
                            onChange={(event) => {
                              setSelection((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(image.mediaPublicId);
                                else next.delete(image.mediaPublicId);
                                return next;
                              });
                            }}
                          />
                          Select
                        </label>
                      </div>
                      <label className="block text-xs font-semibold text-strong">
                        Alt text
                        <input
                          className={`${inputClass} mt-1`}
                          value={altValue}
                          maxLength={500}
                          placeholder="Describe the image for screen readers and SEO"
                          onChange={(event) =>
                            setTextDrafts((current) => ({
                              ...current,
                              [image.mediaPublicId]: {
                                altText: event.target.value,
                                title: current[image.mediaPublicId]?.title ?? image.title ?? "",
                              },
                            }))
                          }
                        />
                      </label>
                      <label className="block text-xs font-semibold text-strong">
                        Title (optional)
                        <input
                          className={`${inputClass} mt-1`}
                          value={titleValue}
                          maxLength={255}
                          onChange={(event) =>
                            setTextDrafts((current) => ({
                              ...current,
                              [image.mediaPublicId]: {
                                altText: current[image.mediaPublicId]?.altText ?? image.altText ?? "",
                                title: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      {draft ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={primaryButtonClass}
                            disabled={isMutating}
                            onClick={() =>
                              runAction(async () => {
                                const result = await updateProductImageTextAction({
                                  productPublicId,
                                  mediaPublicId: image.mediaPublicId,
                                  altText: draft.altText.trim() || null,
                                  title: draft.title.trim() || null,
                                });
                                if (result.ok) {
                                  setTextDrafts((current) => {
                                    const next = { ...current };
                                    delete next[image.mediaPublicId];
                                    return next;
                                  });
                                }
                                return result;
                              }, "Image text saved.")
                            }
                          >
                            {isMutating ? "Saving…" : "Save text"}
                          </button>
                          <button
                            type="button"
                            className={buttonClass}
                            disabled={isMutating}
                            onClick={() =>
                              setTextDrafts((current) => {
                                const next = { ...current };
                                delete next[image.mediaPublicId];
                                return next;
                              })
                            }
                          >
                            Discard
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-900/[0.06] pt-3">
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={isMutating || image.role === "PRIMARY" || image.uploadStatus !== "READY"}
                      onClick={() =>
                        runAction(
                          () =>
                            setPrimaryProductImageAction({
                              productPublicId,
                              mediaPublicId: image.mediaPublicId,
                            }),
                          "Primary image updated.",
                        )
                      }
                    >
                      {image.role === "PRIMARY" ? "Current primary" : "Set as primary"}
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={index === 0}
                      aria-label={`Move ${image.originalFilename ?? "image"} earlier`}
                      onClick={() => moveImage(index, index - 1)}
                    >
                      ↑ Up
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={index === orderedImages.length - 1}
                      aria-label={`Move ${image.originalFilename ?? "image"} later`}
                      onClick={() => moveImage(index, index + 1)}
                    >
                      ↓ Down
                    </button>
                    {image.urls ? (
                      <a
                        href={image.urls.original}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonClass}
                      >
                        Open original
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className={dangerButtonClass}
                      disabled={isMutating}
                      onClick={() => openDeleteDialog([image.mediaPublicId])}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <dialog
        ref={dialogRef}
        className="rounded-2xl border border-ink-900/15 p-0 backdrop:bg-ink-900/40"
        aria-labelledby="delete-images-title"
        onClose={() => setConfirmDelete(null)}
      >
        <div className="max-w-sm p-6">
          <h3 id="delete-images-title" className="text-h5 text-strong">
            Delete {confirmDelete && confirmDelete.length > 1 ? `${confirmDelete.length} images` : "this image"}?
          </h3>
          <p className="mt-2 text-sm text-muted">
            The image is removed from this product immediately. Stored files
            are retired asynchronously and this cannot be undone from here.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={buttonClass} onClick={closeDeleteDialog}>
              Cancel
            </button>
            <button
              type="button"
              className={dangerButtonClass}
              disabled={isMutating}
              onClick={confirmDeletion}
            >
              {isMutating ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
