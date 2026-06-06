import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  FileText, Link2, ExternalLink, FolderOpen, ImageOff,
  ChevronLeft, ChevronRight, RefreshCw, Copy, Check, Layers,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { useChatStore } from "@/store/chat";
import { formatSessionTitle } from "@/lib/session-title";
import {
  collectArtifactsForSession,
  type ArtifactRecord, type ArtifactKind, type ArtifactMessage,
} from "@/lib/artifacts";
import type { SessionSummary } from "@/lib/hermes-types";
import type { MessageRow } from "@/lib/session-messages";
import PageTopBar from "@/components/layout/PageTopBar";
import SearchInput from "@/components/ui/SearchInput";
import IconButton from "@/components/ui/IconButton";
import ImageLightbox, { type LightboxImage } from "@/components/ui/ImageLightbox";

/**
 * ArtifactsPanel — a cross-session gallery of images / files / links, collected
 * purely from the most recent sessions' messages (`collectArtifactsForSession`,
 * a read-only projection — no new storage). Mirrors upstream desktop's Artifacts:
 * scan the 30 most recent sessions, classify each artifact, then render an image
 * grid + a file/link table with search, filter tabs, pagination, session
 * attribution and jump-to-chat.
 */

const RECENT_SESSIONS = 30;
const IMAGE_PAGE = 24;
const FILE_PAGE = 100;

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

/** Only http(s) / data URLs open in a web tab; `file://` local paths can't. */
function isWebOpenable(href: string): boolean {
  return /^(https?:|data:)/i.test(href);
}

async function buildArtifactIndex(): Promise<ArtifactRecord[]> {
  const { sessions } = await api.get<{ sessions: SessionSummary[] }>("/api/sessions?limit=200");
  const recent = [...sessions]
    .sort((x, y) => (y.updated_at ?? y.started_at ?? 0) - (x.updated_at ?? x.started_at ?? 0))
    .slice(0, RECENT_SESSIONS);

  const results = await Promise.allSettled(
    recent.map((s) =>
      api.get<{ messages: MessageRow[] }>(`/api/sessions/${encodeURIComponent(s.session_id)}/messages?limit=500`),
    ),
  );

  const out: ArtifactRecord[] = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const s = recent[i];
    out.push(...collectArtifactsForSession(
      { id: s.session_id, title: formatSessionTitle(s.title), updated_at: s.updated_at, started_at: s.started_at },
      (r.value.messages ?? []) as ArtifactMessage[],
    ));
  });

  return out.sort((a, b) => b.timestamp - a.timestamp);
}

export default function ArtifactsPanel() {
  const { t } = useI18n();
  const a = t.artifacts;
  const navigate = useNavigate();
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const setPendingScrollMessageId = useChatStore((s) => s.setPendingScrollMessageId);

  const { data: artifacts, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["artifacts-index"],
    queryFn: buildArtifactIndex,
    staleTime: 30_000,
  });

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ArtifactKind | "all">("all");
  const [imagePage, setImagePage] = useState(1);
  const [filePage, setFilePage] = useState(1);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);

  useEffect(() => { setImagePage(1); setFilePage(1); }, [artifacts, kind, query]);

  const counts = useMemo(() => {
    const all = artifacts ?? [];
    return {
      all: all.length,
      image: all.filter((x) => x.kind === "image").length,
      file: all.filter((x) => x.kind === "file").length,
      link: all.filter((x) => x.kind === "link").length,
    };
  }, [artifacts]);

  const visible = useMemo(() => {
    const list = artifacts ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((art) => {
      if (kind !== "all" && art.kind !== kind) return false;
      if (!q) return true;
      return (
        art.label.toLowerCase().includes(q) ||
        art.value.toLowerCase().includes(q) ||
        art.sessionTitle.toLowerCase().includes(q)
      );
    });
  }, [artifacts, kind, query]);

  const images = useMemo(() => visible.filter((x) => x.kind === "image"), [visible]);
  const files = useMemo(() => visible.filter((x) => x.kind !== "image"), [visible]);

  const imagePageCount = Math.max(1, Math.ceil(images.length / IMAGE_PAGE));
  const filePageCount = Math.max(1, Math.ceil(files.length / FILE_PAGE));
  const curImagePage = Math.min(imagePage, imagePageCount);
  const curFilePage = Math.min(filePage, filePageCount);
  const pagedImages = images.slice((curImagePage - 1) * IMAGE_PAGE, curImagePage * IMAGE_PAGE);
  const pagedFiles = files.slice((curFilePage - 1) * FILE_PAGE, curFilePage * FILE_PAGE);

  const openChat = (art: ArtifactRecord) => {
    setActiveSession(art.sessionId);
    if (art.messageRowId != null) setPendingScrollMessageId(art.messageRowId);
    navigate("/chat");
  };

  const openImageAt = (index: number) => {
    const ok = pagedImages.filter((x) => isWebOpenable(x.href) && !failed.has(x.id));
    const lbImages: LightboxImage[] = ok.map((x) => ({ src: x.href, alt: x.label }));
    const target = pagedImages[index];
    const pos = ok.findIndex((x) => x.id === target.id);
    if (pos >= 0) setLightbox({ images: lbImages, index: pos });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}>
      <PageTopBar
        title={t.nav.artifacts}
        actions={
          <IconButton
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            title={isFetching ? a.refreshing : a.refresh}
            aria-label={isFetching ? a.refreshing : a.refresh}
          >
            <RefreshCw size={14} className={isFetching ? "hms-spin" : undefined} />
          </IconButton>
        }
        context={
          <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-3)', padding: "6px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', flex: 1, minWidth: 0, flexWrap: "wrap" }}>
              {(["all", "image", "file", "link"] as const).map((k) => {
                const active = kind === k;
                const label = k === "all" ? a.filterAll : k === "image" ? a.filterImages : k === "file" ? a.filterFiles : a.filterLinks;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 'var(--hms-space-1)',
                      padding: "3px 10px", borderRadius: 999,
                      border: `1px solid ${active ? "var(--hms-accent)" : "var(--hms-border)"}`,
                      background: active ? "var(--hms-accent-weak)" : "var(--hms-surface)",
                      color: active ? "var(--hms-accent)" : "var(--hms-text-muted)",
                      fontSize: 'var(--hms-text-caption)', cursor: "pointer",
                    }}
                  >
                    {label} <span style={{ opacity: 0.7 }}>{counts[k]}</span>
                  </button>
                );
              })}
            </div>
            {counts.all > 0 && (
              <SearchInput
                size="sm"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={a.search}
                style={{ width: 200, flexShrink: 0 }}
              />
            )}
          </div>
        }
      />

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 'var(--hms-space-4)' }}>
        {isLoading || artifacts == null ? (
          <div style={{ padding: 'var(--hms-space-6)', color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)' }}>{a.indexing}</div>
        ) : visible.length === 0 ? (
          <EmptyState title={a.empty} hint={a.emptyHint} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-5)' }}>
            {images.length > 0 && (
              <section>
                <SectionHeader
                  label={a.filterImages}
                  page={curImagePage}
                  pageCount={imagePageCount}
                  total={images.length}
                  onPrev={() => setImagePage((p) => Math.max(1, p - 1))}
                  onNext={() => setImagePage((p) => Math.min(imagePageCount, p + 1))}
                  prevLabel={a.prev}
                  nextLabel={a.next}
                />
                <div
                  style={{
                    display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(176px, 1fr))",
                    gap: 'var(--hms-space-2)', marginTop: 'var(--hms-space-2)',
                  }}
                >
                  {pagedImages.map((art, i) => (
                    <ImageCard
                      key={art.id}
                      art={art}
                      t={a}
                      failed={failed.has(art.id)}
                      onFail={() => setFailed((s) => (s.has(art.id) ? s : new Set(s).add(art.id)))}
                      onOpenImage={() => openImageAt(i)}
                      onOpenChat={() => openChat(art)}
                    />
                  ))}
                </div>
              </section>
            )}

            {files.length > 0 && (
              <section>
                <SectionHeader
                  label={kind === "link" ? a.filterLinks : a.filterFiles}
                  page={curFilePage}
                  pageCount={filePageCount}
                  total={files.length}
                  onPrev={() => setFilePage((p) => Math.max(1, p - 1))}
                  onNext={() => setFilePage((p) => Math.min(filePageCount, p + 1))}
                  prevLabel={a.prev}
                  nextLabel={a.next}
                />
                <div
                  style={{
                    marginTop: 'var(--hms-space-2)', borderRadius: 'var(--hms-radius-md)',
                    border: "1px solid var(--hms-border)", overflow: "hidden",
                  }}
                >
                  {pagedFiles.map((art) => (
                    <FileRow key={art.id} art={art} t={a} onOpenChat={() => openChat(art)} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          initialIndex={lightbox.index}
          currentIndex={lightbox.index}
          onIndexChange={(i) => setLightbox((lb) => (lb ? { ...lb, index: i } : lb))}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

type ArtifactT = {
  kindImage: string; kindFile: string; kindLink: string;
  openInChat: string; open: string; copy: string;
};

function SectionHeader({
  label, page, pageCount, total, onPrev, onNext, prevLabel, nextLabel,
}: {
  label: string; page: number; pageCount: number; total: number;
  onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)' }}>
      <span style={{ fontSize: 'var(--hms-text-xs)', fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--hms-text-muted)" }}>
        {label}
      </span>
      <span style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", opacity: 0.7 }}>{total}</span>
      {pageCount > 1 && (
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 'var(--hms-space-2)' }}>
          <button type="button" onClick={onPrev} disabled={page <= 1} aria-label={prevLabel} style={pagerBtn(page <= 1)}>
            <ChevronLeft size={15} />
          </button>
          <span style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)" }}>{page} / {pageCount}</span>
          <button type="button" onClick={onNext} disabled={page >= pageCount} aria-label={nextLabel} style={pagerBtn(page >= pageCount)}>
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function pagerBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 26, height: 26, borderRadius: 6,
    border: "1px solid var(--hms-border)", background: "var(--hms-surface)",
    color: disabled ? "var(--hms-text-muted)" : "var(--hms-text)",
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
  };
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 'var(--hms-space-3)', color: "var(--hms-text-muted)", padding: 'var(--hms-space-8)',
        textAlign: "center", height: "100%",
      }}
    >
      <Layers size={36} style={{ color: "var(--hms-text-muted)" }} />
      <div style={{ fontWeight: 600, color: "var(--hms-text)", fontSize: 'var(--hms-text-body)' }}>{title}</div>
      <div style={{ maxWidth: 420, fontSize: 'var(--hms-text-sm)' }}>{hint}</div>
    </div>
  );
}

function ImageCard({
  art, t, failed, onFail, onOpenImage, onOpenChat,
}: {
  art: ArtifactRecord; t: ArtifactT; failed: boolean;
  onFail: () => void; onOpenImage: () => void; onOpenChat: () => void;
}) {
  return (
    <article style={{ display: "flex", flexDirection: "column", borderRadius: 'var(--hms-radius-md)', border: "1px solid var(--hms-border)", background: "var(--hms-surface)", overflow: "hidden" }}>
      <div
        onClick={failed ? undefined : onOpenImage}
        style={{
          height: 150, display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--hms-hover-bg)", color: "var(--hms-text-muted)",
          borderBottom: "1px solid var(--hms-border)", cursor: failed ? "default" : "zoom-in",
        }}
      >
        {failed ? (
          <ImageOff size={22} />
        ) : (
          <img
            src={art.href}
            alt={art.label}
            loading="lazy"
            decoding="async"
            onError={onFail}
            style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
          />
        )}
      </div>
      <div style={{ padding: 'var(--hms-space-2)', display: "flex", flexDirection: "column", gap: 'var(--hms-space-1)', minWidth: 0 }}>
        <div style={{ fontSize: 'var(--hms-text-xs)', textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--hms-text-muted)" }}>{t.kindImage}</div>
        <div style={{ fontSize: 'var(--hms-text-sm)', fontWeight: 600, color: "var(--hms-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{art.label}</div>
        <div style={{ fontSize: 'var(--hms-text-xs)', fontFamily: "monospace", color: "var(--hms-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{art.value}</div>
        <button
          type="button"
          onClick={onOpenChat}
          style={{
            marginTop: 'var(--hms-space-1)', display: "inline-flex", alignItems: "center", gap: 'var(--hms-space-1)',
            border: "none", background: "none", cursor: "pointer", padding: 0,
            color: "var(--hms-accent)", fontSize: 'var(--hms-text-xs)', textAlign: "left",
          }}
        >
          <FolderOpen size={12} /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{art.sessionTitle}</span>
        </button>
      </div>
    </article>
  );
}

function FileRow({ art, t, onOpenChat }: { art: ArtifactRecord; t: ArtifactT; onOpenChat: () => void }) {
  const isLink = art.kind === "link";
  const Icon = isLink ? Link2 : FileText;
  const webOpen = isWebOpenable(art.href);

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 'var(--hms-space-3)',
        padding: "8px 10px", borderTop: "1px solid var(--hms-border)",
      }}
      className="hms-room-row"
    >
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, flexShrink: 0, borderRadius: 6, background: "var(--hms-hover-bg)", color: "var(--hms-text-muted)" }}>
        <Icon size={14} />
      </span>

      {/* Name + location */}
      <div style={{ minWidth: 0, flex: 1 }}>
        {webOpen ? (
          <a href={art.href} target="_blank" rel="noreferrer" title={t.open} style={{ display: "block", fontSize: 'var(--hms-text-sm)', fontWeight: 600, color: "var(--hms-text)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {art.label}
          </a>
        ) : (
          <div style={{ fontSize: 'var(--hms-text-sm)', fontWeight: 600, color: "var(--hms-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{art.label}</div>
        )}
        <div style={{ fontSize: 'var(--hms-text-xs)', fontFamily: isLink ? undefined : "monospace", color: "var(--hms-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{art.value}</div>
      </div>

      {/* Session attribution → jump to chat */}
      <button
        type="button"
        onClick={onOpenChat}
        title={art.sessionTitle}
        style={{
          display: "flex", flexDirection: "column", alignItems: "flex-end", maxWidth: 180, flexShrink: 0,
          border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--hms-text-muted)",
        }}
      >
        <span style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{art.sessionTitle}</span>
        <span style={{ fontSize: 'var(--hms-text-xs)', opacity: 0.7 }}>{TIME_FMT.format(new Date(art.timestamp))}</span>
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-1)', flexShrink: 0 }}>
        <CopyBtn text={art.value} label={t.copy} />
        {webOpen && (
          <a href={art.href} target="_blank" rel="noreferrer" title={t.open} aria-label={t.open} style={iconLink}>
            <ExternalLink size={14} />
          </a>
        )}
        <button type="button" onClick={onOpenChat} title={t.openInChat} aria-label={t.openInChat} style={{ ...iconLink, border: "none", background: "none", cursor: "pointer" }}>
          <FolderOpen size={14} />
        </button>
      </div>
    </div>
  );
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setDone(true);
      window.setTimeout(() => setDone(false), 1200);
    }).catch(() => { /* clipboard blocked */ });
  };
  return (
    <button type="button" onClick={copy} title={label} aria-label={label} style={{ ...iconLink, border: "none", background: "none", cursor: "pointer" }}>
      {done ? <Check size={14} style={{ color: "var(--hms-success-text)" }} /> : <Copy size={14} />}
    </button>
  );
}

const iconLink: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 28, height: 28, borderRadius: 6,
  color: "var(--hms-text-muted)", textDecoration: "none",
};
