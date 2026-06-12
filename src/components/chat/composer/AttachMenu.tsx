import { useEffect, useRef, useState } from "react";
import {
  Plus, FileText, FolderOpen, Image as ImageIcon, Clipboard, Link2, MessageSquareText,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { ToolbarBtn } from "./parts";

/**
 * Composer "+" attach menu (desktop parity, web equivalents): Files / Folder /
 * Images / Paste image / URL / Prompt snippets. Pickers ride the upload
 * pipeline; URL + snippets insert into the draft text.
 */
export default function AttachMenu({
  onPickFiles, onPickFolder, onPickImages, onPasteImage, onInsertText,
}: {
  onPickFiles: () => void;
  onPickFolder: () => void;
  onPickImages: () => void;
  onPasteImage: () => void;
  onInsertText: (text: string) => void;
}) {
  const { t } = useI18n();
  const c = t.composer;
  const [open, setOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [url, setUrl] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (urlOpen) requestAnimationFrame(() => urlInputRef.current?.focus());
  }, [urlOpen]);

  const item = (icon: React.ReactNode, label: string, action: () => void) => (
    <button
      type="button"
      className="hms-attach-item"
      onClick={() => { setOpen(false); action(); }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const submitUrl = () => {
    const trimmed = url.trim();
    if (trimmed) onInsertText(trimmed + " ");
    setUrl("");
    setUrlOpen(false);
  };

  const snippets = c.snippets;

  return (
    <div ref={wrapRef} className="hms-attach-wrap">
      <ToolbarBtn title={c.attachLabel} onClick={() => setOpen((v) => !v)}>
        <Plus size={16} />
      </ToolbarBtn>

      {open && (
        <div className="hms-attach-menu" role="menu">
          <div className="hms-attach-label">{c.attachLabel}</div>
          {item(<FileText size={14} />, c.files, onPickFiles)}
          {item(<FolderOpen size={14} />, c.folder, onPickFolder)}
          {item(<ImageIcon size={14} />, c.images, onPickImages)}
          {item(<Clipboard size={14} />, c.pasteImage, onPasteImage)}
          {item(<Link2 size={14} />, c.url, () => setUrlOpen(true))}
          <div className="hms-attach-divider" />
          {item(<MessageSquareText size={14} />, c.promptSnippets, () => setSnippetsOpen(true))}
        </div>
      )}

      {urlOpen && (
        <div className="hms-attach-menu hms-attach-dialog">
          <div className="hms-attach-label">{c.urlTitle}</div>
          <form
            className="hms-attach-url-form"
            onSubmit={(e) => { e.preventDefault(); submitUrl(); }}
          >
            <input
              ref={urlInputRef}
              type="text"
              inputMode="url"
              className="hms-input"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setUrlOpen(false); }}
            />
            <button type="submit" className="hms-attach-add" disabled={!url.trim()}>
              {c.urlAdd}
            </button>
          </form>
        </div>
      )}

      {snippetsOpen && (
        <div className="hms-attach-menu hms-attach-dialog">
          <div className="hms-attach-label">{c.snippetsTitle}</div>
          {(Object.keys(snippets) as Array<keyof typeof snippets>).map((key) => {
            const s = snippets[key];
            return (
              <button
                key={key}
                type="button"
                className="hms-attach-snippet"
                onClick={() => { onInsertText(s.text); setSnippetsOpen(false); }}
              >
                <span className="hms-attach-snippet-label">{s.label}</span>
                <span className="hms-attach-snippet-desc">{s.description}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
