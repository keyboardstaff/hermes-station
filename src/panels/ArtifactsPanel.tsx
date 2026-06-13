import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  FileText, Link2, ExternalLink, FolderOpen, ImageOff, GitBranch, FilePen,
  ChevronLeft, ChevronRight, Copy, Check, Layers,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { useChatStore } from "@/store/chat";
import { useFilesSelection } from "@/store/panel-selection";
import { formatSessionTitle } from "@/lib/session-title";
import {
  collectArtifactsForSession,
  type ArtifactRecord, type ArtifactMessage,
} from "@/lib/artifacts";
import { resolveFileTarget, hasFileExtension, type FileTarget, type WorkspaceDir } from "@/lib/file-target";
import type { SessionSummary } from "@/lib/hermes-types";
import type { MessageRow } from "@/lib/session-messages";
import { profileQuery } from "@/lib/load-session";
import PageTopBar from "@/components/layout/PageTopBar";
import SearchInput from "@/components/ui/SearchInput";
import ImageLightbox, { type LightboxImage } from "@/components/ui/ImageLightbox";
import DocPreview from "@/components/files/DocPreview";

/** Shared 2-column grid for the file/link table (NAME · SESSION). NAME stacks
 *  the label over its location (path / url), so there's no separate column. */

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

type ArtifactFilter = "all" | "edit" | "git" | "image" | "file" | "link";
const FILTERS: ArtifactFilter[] = ["all", "edit", "git", "image", "file", "link"];

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

/** Only http(s) / data URLs open in a web tab; `file://` local paths can't. */
function isWebOpenable(href: string): boolean {
  return /^(https?:|data:)/i.test(href);
}

function recencyOf(s: SessionSummary): number {
  return s.last_active ?? s.updated_at ?? s.started_at ?? 0;
}

async function buildArtifactIndex(): Promise<ArtifactRecord[]> {
  // The server orders by last activity when asked — grab the most-recently-active
  // sessions (the index spans them, like upstream desktop's `listSessions(30)`).
  const { sessions } = await api.get<{ sessions: SessionSummary[] }>(
    `/api/sessions?sort=last_active&limit=${RECENT_SESSIONS}`,
  );
  const recent = [...sessions].sort((x, y) => recencyOf(y) - recencyOf(x)).slice(0, RECENT_SESSIONS);

  const results = await Promise.allSettled(
    // Each row carries its owning profile (cross-home list) — read its messages
    // from that profile's state.db, else a non-default session yields no artifacts.
    recent.map((s) =>
      api.get<{ messages: MessageRow[] }>(
        `/api/sessions/${encodeURIComponent(s.session_id)}/messages?limit=500${profileQuery(s.profile)}`,
      ),
    ),
  );

  const out: ArtifactRecord[] = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const s = recent[i];
    out.push(...collectArtifactsForSession(
      { id: s.session_id, title: formatSessionTitle(s.title), cwd: s.cwd, updated_at: recencyOf(s), started_at: s.started_at },
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
  const setFileSelection = useFilesSelection((s) => s.setSelected);

  const { data: artifacts, isLoading } = useQuery({
    queryKey: ["artifacts-index"],
    queryFn: buildArtifactIndex,
    staleTime: 30_000,
  });

  // Workspace dirs let us map an absolute file path onto a Files-page root so a
  // file artifact can open in the file preview (text files), like links do.
  const { data: wsData } = useQuery<{ workspaces: WorkspaceDir[] }>({
    queryKey: ["files-workspaces"],
    queryFn: () => api.get<{ workspaces: WorkspaceDir[] }>("/api/files/workspaces"),
    staleTime: 60_000,
  });
  const workspaces = useMemo(() => wsData?.workspaces ?? [], [wsData]);

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ArtifactFilter>("all");
  const [imagePage, setImagePage] = useState(1);
  const [filePage, setFilePage] = useState(1);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);
  const [docPreview, setDocPreview] = useState<{ target: FileTarget; label: string } | null>(null);

  useEffect(() => { setImagePage(1); setFilePage(1); }, [artifacts, kind, query]);
  // A fresh index is a clean slate — don't carry stale "broken image" marks
  // (a transient load failure shouldn't permanently hide a thumbnail).
  useEffect(() => { setFailed(new Set()); }, [artifacts]);

  const counts = useMemo(() => {
    const all = artifacts ?? [];
    const ref = all.filter((x) => x.group === "ref");
    return {
      all: all.length,
      edit: all.filter((x) => x.group === "edit").length,
      git: all.filter((x) => x.group === "git").length,
      image: ref.filter((x) => x.kind === "image").length,
      file: ref.filter((x) => x.kind === "file").length,
      link: ref.filter((x) => x.kind === "link").length,
    };
  }, [artifacts]);

  const matchesFilter = (art: ArtifactRecord): boolean => {
    if (kind === "all") return true;
    if (kind === "edit" || kind === "git") return art.group === kind;
    return art.group === "ref" && art.kind === kind;
  };

  const visible = useMemo(() => {
    const list = artifacts ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((art) => {
      if (!matchesFilter(art)) return false;
      if (!q) return true;
      return (
        art.label.toLowerCase().includes(q) ||
        art.value.toLowerCase().includes(q) ||
        art.sessionTitle.toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifacts, kind, query]);

  const changes = useMemo(() => visible.filter((x) => x.group === "edit"), [visible]);
  const gits = useMemo(() => visible.filter((x) => x.group === "git"), [visible]);
  const images = useMemo(() => visible.filter((x) => x.group === "ref" && x.kind === "image"), [visible]);
  const files = useMemo(() => visible.filter((x) => x.group === "ref" && x.kind !== "image"), [visible]);

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

  const openFileInFiles = (target: FileTarget) => {
    setFileSelection(target);
    navigate("/files", { state: { from: "artifacts" } });
  };

  return (
    <div className="hms-artifacts-root">
      <PageTopBar
        title={t.nav.artifacts}
        showProfileScope
        context={
          <div className="hms-artifacts-toolbar">
            <div className="hms-artifacts-filters">
              {FILTERS.map((k) => {
                const active = kind === k;
                const label = k === "all" ? a.filterAll
                  : k === "edit" ? a.filterChanges : k === "git" ? a.filterGit
                  : k === "image" ? a.filterImages : k === "file" ? a.filterFiles : a.filterLinks;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className="hms-artifacts-chip"
                    data-active={active || undefined}
                  >
                    {label} <span className="hms-artifacts-chip-count">{counts[k]}</span>
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

      <div className="hms-artifacts-body">
        {isLoading || artifacts == null ? (
          <div className="hms-artifacts-indexing">{a.indexing}</div>
        ) : visible.length === 0 ? (
          counts.all > 0
            ? <EmptyState title={a.noMatches} hint={a.noMatchesHint} />
            : <EmptyState title={a.empty} hint={a.emptyHint} />
        ) : (
          <div className="hms-artifacts-sections">
            {changes.length > 0 && (
              <GroupTable title={a.groupChanges} count={changes.length} colName={a.colName} colSession={a.colSession}>
                {changes.map((art) => (
                  <FileRow
                    key={art.id}
                    art={art}
                    t={a}
                    fileTarget={hasFileExtension(art.value) ? resolveFileTarget(art.value, workspaces, art.sessionCwd) : null}
                    onPreviewFile={(target) => setDocPreview({ target, label: art.label })}
                    onOpenChat={() => openChat(art)}
                  />
                ))}
              </GroupTable>
            )}

            {gits.length > 0 && (
              <GroupTable title={a.groupGit} count={gits.length} colName={a.colName} colSession={a.colSession}>
                {gits.map((art) => (
                  <FileRow
                    key={art.id}
                    art={art}
                    t={a}
                    fileTarget={null}
                    onPreviewFile={() => { /* git has no file target */ }}
                    onOpenChat={() => openChat(art)}
                  />
                ))}
              </GroupTable>
            )}

            {images.length > 0 && (
              <section>
                <SectionHeader
                  itemsLabel={a.itemsImage}
                  page={curImagePage}
                  pageCount={imagePageCount}
                  total={images.length}
                  onPrev={() => setImagePage((p) => Math.max(1, p - 1))}
                  onNext={() => setImagePage((p) => Math.min(imagePageCount, p + 1))}
                  prevLabel={a.prev}
                  nextLabel={a.next}
                />
                <div className="hms-artifacts-image-grid">
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
                  itemsLabel={kind === "link" ? a.itemsLink : kind === "file" ? a.itemsFile : a.items}
                  page={curFilePage}
                  pageCount={filePageCount}
                  total={files.length}
                  onPrev={() => setFilePage((p) => Math.max(1, p - 1))}
                  onNext={() => setFilePage((p) => Math.min(filePageCount, p + 1))}
                  prevLabel={a.prev}
                  nextLabel={a.next}
                />
                <div className="hms-artifacts-table">
                  {/* Column headers (NAME · SESSION) */}
                  <div className="hms-artifacts-table-head">
                    <span>{a.colName}</span>
                    <span>{a.colSession}</span>
                  </div>
                  {pagedFiles.map((art) => (
                    <FileRow
                      key={art.id}
                      art={art}
                      t={a}
                      fileTarget={art.kind === "file" && hasFileExtension(art.value) ? resolveFileTarget(art.value, workspaces, art.sessionCwd) : null}
                      onPreviewFile={(target) => setDocPreview({ target, label: art.label })}
                      onOpenChat={() => openChat(art)}
                    />
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

      {docPreview && (
        <DocPreview
          target={docPreview.target}
          label={docPreview.label}
          onClose={() => setDocPreview(null)}
          onOpenInFiles={() => { openFileInFiles(docPreview.target); setDocPreview(null); }}
        />
      )}
    </div>
  );
}

type ArtifactT = {
  kindImage: string; kindFile: string; kindLink: string;
  openInChat: string; open: string; copy: string; noPreview: string;
};

function SectionHeader({
  itemsLabel, page, pageCount, total, onPrev, onNext, prevLabel, nextLabel,
}: {
  itemsLabel: string; page: number; pageCount: number; total: number;
  onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string;
}) {
  return (
    <div className="hms-artifacts-section-head">
      <span className="hms-artifacts-section-count">{total} {itemsLabel}</span>
      {pageCount > 1 && (
        <div className="hms-artifacts-pager">
          <button type="button" onClick={onPrev} disabled={page <= 1} aria-label={prevLabel} className="hms-artifacts-pager-btn">
            <ChevronLeft size={15} />
          </button>
          <span className="hms-artifacts-pager-pos">{page} / {pageCount}</span>
          <button type="button" onClick={onNext} disabled={page >= pageCount} aria-label={nextLabel} className="hms-artifacts-pager-btn">
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

/** A titled, bordered rows table (Changes / Git) sharing the file/link layout. */
function GroupTable({
  title, count, colName, colSession, children,
}: {
  title: string; count: number; colName: string; colSession: string; children: React.ReactNode;
}) {
  return (
    <section>
      <div className="hms-artifacts-group-head">
        <span className="hms-artifacts-group-title">{title}</span>
        <span className="hms-artifacts-group-count">{count}</span>
      </div>
      <div className="hms-artifacts-table">
        <div className="hms-artifacts-table-head">
          <span>{colName}</span>
          <span>{colSession}</span>
        </div>
        {children}
      </div>
    </section>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="hms-artifacts-empty">
      <Layers size={36} />
      <div className="hms-artifacts-empty-title">{title}</div>
      <div className="hms-artifacts-empty-hint">{hint}</div>
    </div>
  );
}

function ImageCard({
  art, t, failed, onFail, onOpenImage, onOpenChat,
}: {
  art: ArtifactRecord; t: ArtifactT; failed: boolean;
  onFail: () => void; onOpenImage: () => void; onOpenChat: () => void;
}) {
  // A web client can only render http(s)/data images. `file://` local paths
  // (the common case for agent-written images) can't load, so show a clear
  // "no preview" placeholder instead of firing a doomed request per card.
  const previewable = isWebOpenable(art.href) && !failed;
  return (
    <article className="hms-artifacts-img-card">
      <div
        onClick={previewable ? onOpenImage : undefined}
        title={previewable ? art.label : t.noPreview}
        className="hms-artifacts-img-preview"
        data-previewable={previewable || undefined}
      >
        {previewable ? (
          <img
            src={art.href}
            alt={art.label}
            loading="lazy"
            decoding="async"
            onError={onFail}
            className="hms-artifacts-img"
          />
        ) : (
          <ImageOff size={22} />
        )}
      </div>
      <div className="hms-artifacts-img-meta">
        <div className="hms-artifacts-img-kind">{t.kindImage}</div>
        <div title={art.label} className="hms-artifacts-img-label">{art.label}</div>
        <div title={art.value} className="hms-artifacts-img-value">{art.value}</div>
        <button type="button" onClick={onOpenChat} title={t.openInChat} className="hms-artifacts-img-chat">
          <FolderOpen size={12} className="hms-artifacts-row-icon" />{" "}
          <span className="hms-artifacts-ellipsis">{art.sessionTitle}</span>
        </button>
      </div>
    </article>
  );
}

function FileRow({
  art, t, fileTarget, onPreviewFile, onOpenChat,
}: {
  art: ArtifactRecord;
  t: ArtifactT;
  fileTarget: FileTarget | null;
  onPreviewFile: (target: FileTarget) => void;
  onOpenChat: () => void;
}) {
  const isLink = art.kind === "link";
  const isGit = art.group === "git";
  const Icon = isGit ? GitBranch : art.group === "edit" ? FilePen : isLink ? Link2 : FileText;
  const linkHref = isLink && isWebOpenable(art.href) ? art.href : null;

  const titleInner = (
    <>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, flexShrink: 0, borderRadius: 6, background: "var(--hms-hover-bg)", color: "var(--hms-text-muted)" }}>
        <Icon size={13} />
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 'var(--hms-text-sm)', fontWeight: 600, color: "var(--hms-text)" }}>
        {art.label}
      </span>
      {linkHref && <ExternalLink size={12} style={{ flexShrink: 0, color: "var(--hms-text-muted)" }} />}
    </>
  );

  return (
    <div className="hms-sidebar-row hms-artifacts-row">
      {/* NAME — label (opens: link → new tab, file → rendered preview) stacked
          over its location (path / url) + copy. */}
      <div className="hms-artifacts-name">
        {linkHref ? (
          <a href={linkHref} target="_blank" rel="noreferrer" title={t.open} className="hms-artifacts-title">{titleInner}</a>
        ) : fileTarget ? (
          <button type="button" onClick={() => onPreviewFile(fileTarget)} title={t.open} className="hms-artifacts-title">{titleInner}</button>
        ) : (
          <div title={art.label} className="hms-artifacts-title">{titleInner}</div>
        )}
        {/* Location line — hidden for git (the command is already the title). */}
        {!isGit && (
          <div className="hms-artifacts-loc">
            <span title={art.value} className="hms-artifacts-loc-val" data-link={isLink || undefined}>
              {art.value}
            </span>
            <CopyBtn text={art.value} label={t.copy} />
          </div>
        )}
      </div>

      {/* SESSION — attribution → jump to chat */}
      <button type="button" onClick={onOpenChat} title={t.openInChat} className="hms-artifacts-session">
        <span className="hms-artifacts-session-title">{art.sessionTitle}</span>
        <span className="hms-artifacts-session-time">{TIME_FMT.format(new Date(art.timestamp))}</span>
      </button>
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
    <button type="button" onClick={copy} title={label} aria-label={label} className="hms-artifacts-copy">
      {done ? <Check size={14} style={{ color: "var(--hms-success-text)" }} /> : <Copy size={14} />}
    </button>
  );
}
