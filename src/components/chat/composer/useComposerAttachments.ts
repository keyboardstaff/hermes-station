import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { zipEpubDirectory } from "@/lib/epub-zip";
import type { ComposerAttachment } from "@/lib/hermes-types";

/**
 * Owns composer attachment state + every ingest path (file picker, paste, drag,
 * imperative addFiles). Extracted from Composer (owner-review D7); the four
 * previously-duplicated handlers now funnel through one `ingestFiles`.
 *
 * Uploads go to POST /api/upload (persisted across refreshes). `maxBytes` is the
 * caps-derived hard cap; `selectedModel` drives the lazy, non-blocking vision probe.
 */
export function useComposerAttachments({
  sessionId,
  maxBytes,
  selectedModel,
}: {
  sessionId?: string | null;
  maxBytes: number;
  selectedModel: string | null;
}) {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!uploadError) return;
    const t = setTimeout(() => setUploadError(null), 5000);
    return () => clearTimeout(t);
  }, [uploadError]);

  const fileToAttachment = useCallback(async (file: File): Promise<ComposerAttachment> => {
    if (file.size > maxBytes) {
      throw new Error(`File ${file.name} exceeds the ${Math.round(maxBytes / (1024 * 1024))} MiB limit`);
    }

    let uploadFile: File = file;
    // macOS APFS .epub dirs appear as 512-byte stubs — repackage to real ZIP.
    if (/\.epub$/i.test(file.name) && file.size <= 512) {
      try {
        const entry = (file as File & { webkitGetAsEntry?: () => FileSystemEntry }).webkitGetAsEntry?.();
        if (entry?.isDirectory) uploadFile = await zipEpubDirectory(file);
      } catch { /* original file works for most cases */ }
    }

    const extra: Record<string, string> = {};
    if (sessionId) extra.session_id = sessionId;
    const meta = await api.upload<{
      url: string; name: string; mime: string; size: number;
      is_image: boolean; is_audio?: boolean; is_video?: boolean;
    }>("/api/upload", uploadFile, extra);
    return {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: meta.name,
      mimeType: meta.mime,
      content: meta.url,
      isImage: meta.is_image,
      isAudio: meta.is_audio,
      isVideo: meta.is_video,
    };
  }, [sessionId, maxBytes]);

  // Vision probe is lazy + non-blocking; {ok:false} → console notice, never blocks send.
  const warnIfNoVision = useCallback(async () => {
    if (!selectedModel) return;
    try {
      const r = await api.get<{ ok: boolean; model: string; source: string }>(
        `/api/models/vision-check?model=${encodeURIComponent(selectedModel)}`,
      );
      if (!r.ok) {
        console.info(`[composer] ${selectedModel} reports no vision (${r.source}); image will be sent but the model may ignore it.`);
      }
    } catch {
      /* network blip — send path still works */
    }
  }, [selectedModel]);

  // Single ingest path: upload each file, append on success, probe vision once
  // per batch (N images of one model → one console notice).
  const ingestFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    let warned = false;
    files.forEach((file) => {
      fileToAttachment(file).then((att) => {
        setAttachments((prev) => [...prev, att]);
        if (!warned && att.isImage) {
          warned = true;
          void warnIfNoVision();
        }
      }).catch((err) => {
        setUploadError(err instanceof Error ? err.message : "upload failed");
      });
    });
  }, [fileToAttachment, warnIfNoVision]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";
    ingestFiles(files);
  }, [ingestFiles]);

  // Paste: pull media from clipboard; text falls through to default textarea handler.
  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const mediaFiles: File[] = [];
    for (const item of items) {
      if (item.kind !== "file") continue;
      const t = item.type;
      if (t.startsWith("image/") || t.startsWith("audio/") || t.startsWith("video/")) {
        const f = item.getAsFile();
        if (f) mediaFiles.push(f);
      }
    }
    if (mediaFiles.length === 0) return;
    e.preventDefault();
    ingestFiles(mediaFiles);
  }, [ingestFiles]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.some((t) => t === "Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only clear when leaving the composer box itself, not its children.
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    ingestFiles(Array.from(e.dataTransfer.files));
  }, [ingestFiles]);

  const removeAttachment = useCallback(
    (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id)),
    [],
  );
  const clear = useCallback(() => setAttachments([]), []);

  return {
    attachments,
    uploadError,
    setUploadError,
    dragOver,
    ingestFiles,
    onFileChange,
    onPaste,
    onDragOver,
    onDragLeave,
    onDrop,
    removeAttachment,
    clear,
  };
}
